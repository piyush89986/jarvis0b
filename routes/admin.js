const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const User = require('../models/User');
const ChatMessage = require('../models/ChatMessage');
const KnowledgeFile = require('../models/KnowledgeFile');

// ─────────────────────────────────────────────
// GET /api/admin/users — List all users with stats
// ─────────────────────────────────────────────
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    
    // Enrich with statistics (message count, notes chunks, streaks)
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const messageCount = await ChatMessage.countDocuments({ userId: u._id });
      
      // Get notes stats
      const files = await KnowledgeFile.find({ userId: u._id }).lean();
      const notesChunkCount = files.reduce((acc, curr) => acc + (curr.chunkCount || 0), 0);

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        streak: u.streak,
        messageCount,
        notesChunkCount,
        createdAt: u.createdAt,
      };
    }));

    res.json({ success: true, users: enrichedUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/user/:userId/chats — Fetch messages for a user
// ─────────────────────────────────────────────
router.get('/user/:userId/chats', protect, admin, async (req, res) => {
  try {
    const { userId } = req.params;

    const messages = await ChatMessage.find({ userId })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
