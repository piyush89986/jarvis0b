const mongoose = require('mongoose');

const knowledgeFileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    cloudinaryUrl: {
      type: String,
      required: true,
    },
    cloudinaryPublicId: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ['pdf', 'image', 'doc', 'docx', 'txt', 'video', 'other'],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    tags: [{ type: String, trim: true }],
    // Processing status
    status: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
    },
    errorMessage: {
      type: String,
      default: null,
    },
    // Stats after processing
    extractedTextLength: {
      type: Number,
      default: 0,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    // File size in bytes
    fileSize: {
      type: Number,
      default: 0,
    },
    // Is this a PYQ (Previous Year Question) paper?
    isPYQ: {
      type: Boolean,
      default: false,
    },
    year: {
      type: Number,
      default: null,
    },
    rawText: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('KnowledgeFile', knowledgeFileSchema);
