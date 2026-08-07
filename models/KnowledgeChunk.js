const mongoose = require('mongoose');

// Each "knowledge chunk" is a small piece of text from an uploaded file
// paired with its vector embedding for semantic search
const knowledgeChunkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeFile',
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    chunkText: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      default: 0,
    },
    // OpenAI text-embedding-3-small produces 1536-dim vectors
    embedding: {
      type: [Number],
      required: true,
    },
    metadata: {
      fileName: String,
      fileType: String,
      pageNumber: Number,
      totalPages: Number,
      tags: [String],
    },
  },
  { timestamps: true }
);

// NOTE: For vector search, you need to create a Search Index in MongoDB Atlas UI:
// Collection: knowledgechunks
// Index name: vector_index
// Field: embedding, type: vector, dimensions: 1536, similarity: cosine
knowledgeChunkSchema.index({ userId: 1, subject: 1 });

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
