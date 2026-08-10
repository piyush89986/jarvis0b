const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    // For voice messages
    audioUrl: {
      type: String,
      default: null,
    },
    // Was this answered from knowledge base?
    usedRAG: {
      type: Boolean,
      default: false,
    },
    // Sources used (if RAG)
    sources: [
      {
        fileName: String,
        subject: String,
        chunkText: String,
      },
    ],
    // Token usage for tracking
    tokensUsed: {
      type: Number,
      default: 0,
    },
    // YouTube video ID for embedded player
    youtubeId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index for fast chat history retrieval
chatMessageSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
