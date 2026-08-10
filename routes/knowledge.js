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

// ─────────────────────────────────────────────
// GET /api/knowledge/text — Fetch user's direct text knowledge base
// ─────────────────────────────────────────────
router.get('/text', protect, async (req, res) => {
  try {
    const directFile = await KnowledgeFile.findOne({
      userId: req.user._id,
      originalName: 'Direct Text Input',
      fileType: 'txt',
    });

    res.json({
      success: true,
      text: directFile ? directFile.rawText : '',
      subject: directFile ? directFile.subject : 'General',
    });
  } catch (error) {
    console.error('Fetch text knowledge base error:', error);
    res.status(500).json({ success: false, message: 'Text load nahi ho paya', error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/knowledge/text — Save/update user's direct text knowledge base
// ─────────────────────────────────────────────
router.post('/text', protect, async (req, res) => {
  try {
    const { text, subject = 'General' } = req.body;
    
    // Find or create the virtual file
    let directFile = await KnowledgeFile.findOne({
      userId: req.user._id,
      originalName: 'Direct Text Input',
      fileType: 'txt',
    });

    if (!directFile) {
      directFile = new KnowledgeFile({
        userId: req.user._id,
        originalName: 'Direct Text Input',
        cloudinaryUrl: 'local',
        cloudinaryPublicId: 'local',
        fileType: 'txt',
        subject: subject,
        status: 'pending',
      });
    }

    directFile.rawText = text || '';
    directFile.fileSize = Buffer.byteLength(text || '', 'utf8');
    directFile.subject = subject;
    directFile.status = 'processing';
    await directFile.save();

    // Delete old chunks
    await deleteFileChunks(directFile._id);

    // If no text, we just mark it processed with 0 chunks
    if (!text?.trim()) {
      directFile.status = 'processed';
      directFile.chunkCount = 0;
      await directFile.save();
      return res.json({
        success: true,
        message: 'Knowledge base clear kar diya gaya hai!',
        file: directFile,
      });
    }

    // Process and store the new chunks
    try {
      const { chunksCreated } = await processAndStoreDocument({
        userId: req.user._id,
        fileId: directFile._id,
        subject,
        extractedText: text,
        metadata: {
          fileName: 'Direct Text Input',
          fileType: 'txt',
        },
      });

      directFile.status = 'processed';
      directFile.chunkCount = chunksCreated;
      await directFile.save();

      res.json({
        success: true,
        message: 'Knowledge base update ho gaya! J.A.R.V.I.S ab iska use karega 🧠',
        file: directFile,
      });
    } catch (processError) {
      console.error('Text embedding error:', processError);
      directFile.status = 'failed';
      directFile.errorMessage = processError.message;
      await directFile.save();
      res.status(500).json({ success: false, message: 'Notes embed nahi ho paye', error: processError.message });
    }
  } catch (error) {
    console.error('Save text knowledge base error:', error);
    res.status(500).json({ success: false, message: 'Save fail ho gaya', error: error.message });
  }
});

module.exports = router;
