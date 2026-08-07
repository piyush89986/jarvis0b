const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { uploadKnowledge, getFileType } = require('../middleware/upload');
const KnowledgeFile = require('../models/KnowledgeFile');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const cloudinary = require('../config/cloudinary');
const { extractText } = require('../services/extractService');
const { processAndStoreDocument, deleteFileChunks, getUserSubjects } = require('../services/ragService');

// ─────────────────────────────────────────────
// POST /api/knowledge/upload — Upload a file
// ─────────────────────────────────────────────
router.post('/upload', protect, (req, res) => {
  uploadKnowledge(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File select kar pehle bhai' });
      }

      const { subject, tags, isPYQ, year } = req.body;
      if (!subject) {
        return res.status(400).json({ success: false, message: 'Subject batao — kaunse subject ki file hai?' });
      }

      const fileType = getFileType(req.file.mimetype);
      const tagsArray = tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim())) : [];

      // 1. Upload to Cloudinary
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `jarvis/${req.user._id}/${subject}`,
            resource_type: 'auto',
            public_id: `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      // 2. Save file record to DB
      const knowledgeFile = await KnowledgeFile.create({
        userId: req.user._id,
        originalName: req.file.originalname,
        cloudinaryUrl: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        fileType,
        subject,
        tags: tagsArray,
        status: 'processing',
        fileSize: req.file.size,
        isPYQ: isPYQ === 'true' || isPYQ === true,
        year: year ? parseInt(year) : null,
      });

      // 3. Send response immediately — process in background
      res.json({
        success: true,
        message: `File upload ho gayi! Ab process ho rahi hai — thoda wait kar bhai 🔄`,
        file: knowledgeFile,
      });

      // 4. Process asynchronously (extract text + embed + store)
      try {
        const { text, numPages } = await extractText(req.file.buffer, fileType);

        if (!text || text.trim().length < 50) {
          await KnowledgeFile.findByIdAndUpdate(knowledgeFile._id, {
            status: 'failed',
            errorMessage: 'Text extract nahi ho paya — file readable hai?',
          });
          return;
        }

        const { chunksCreated } = await processAndStoreDocument({
          userId: req.user._id,
          fileId: knowledgeFile._id,
          subject,
          extractedText: text,
          metadata: {
            fileName: req.file.originalname,
            fileType,
            totalPages: numPages,
            tags: tagsArray,
          },
        });

        await KnowledgeFile.findByIdAndUpdate(knowledgeFile._id, {
          status: 'processed',
          extractedTextLength: text.length,
          chunkCount: chunksCreated,
        });

        console.log(`✅ File processed: ${req.file.originalname} → ${chunksCreated} chunks`);
      } catch (processError) {
        console.error('Background processing error:', processError);
        await KnowledgeFile.findByIdAndUpdate(knowledgeFile._id, {
          status: 'failed',
          errorMessage: processError.message,
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ success: false, message: 'Upload fail ho gaya', error: error.message });
    }
  });
});

// ─────────────────────────────────────────────
// GET /api/knowledge/files — List user's files
// ─────────────────────────────────────────────
router.get('/files', protect, async (req, res) => {
  try {
    const { subject, status } = req.query;
    const filter = { userId: req.user._id };
    if (subject) filter.subject = subject;
    if (status) filter.status = status;

    const files = await KnowledgeFile.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/knowledge/subjects — Get all subjects
// ─────────────────────────────────────────────
router.get('/subjects', protect, async (req, res) => {
  try {
    const subjects = await getUserSubjects(req.user._id);
    // Also get file count per subject
    const subjectStats = await KnowledgeFile.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$subject', fileCount: { $sum: 1 }, chunkCount: { $sum: '$chunkCount' } } },
    ]);

    res.json({ success: true, subjects, subjectStats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/knowledge/file/:fileId — Delete a file
// ─────────────────────────────────────────────
router.delete('/file/:fileId', protect, async (req, res) => {
  try {
    const file = await KnowledgeFile.findOne({ _id: req.params.fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({ success: false, message: 'File nahi mili' });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: 'auto' });

    // Delete chunks from DB
    await deleteFileChunks(file._id);

    // Delete file record
    await KnowledgeFile.findByIdAndDelete(file._id);

    res.json({ success: true, message: 'File delete ho gayi bhai' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/knowledge/file/:fileId/status — Check processing status
// ─────────────────────────────────────────────
router.get('/file/:fileId/status', protect, async (req, res) => {
  try {
    const file = await KnowledgeFile.findOne({ _id: req.params.fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({ success: false, message: 'File nahi mili' });
    }
    res.json({ success: true, status: file.status, chunkCount: file.chunkCount, errorMessage: file.errorMessage });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
