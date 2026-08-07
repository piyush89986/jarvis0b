const multer = require('multer');
const path = require('path');

// Allowed file types
const allowedTypes = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/webm': 'audio',
  'audio/mp4': 'audio',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
};

// Memory storage (buffer) — we'll upload to Cloudinary from buffer
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (allowedTypes[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`Bhai ye file type (${file.mimetype}) support nahi karta — PDF, DOCX, TXT, images hi upload kar`), false);
  }
};

// Knowledge base file upload (max 50MB)
const uploadKnowledge = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');

// Audio upload for voice (max 25MB — Whisper limit)
const uploadAudio = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('audio');

// Helper to get file type from mimetype
const getFileType = (mimetype) => allowedTypes[mimetype] || 'other';

module.exports = { uploadKnowledge, uploadAudio, getFileType };
