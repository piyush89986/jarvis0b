const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ChatMessage = require('../models/ChatMessage');
const { chat } = require('../services/openaiService');
const { retrieveRelevantChunks } = require('../services/ragService');
const { v4: uuidv4 } = require('uuid');
const { searchYouTube } = require('../services/youtubeService');

// ─────────────────────────────────────────────
// POST /api/chat/message — Send a message (REST fallback)
// Main chat happens via Socket.IO for streaming
// ─────────────────────────────────────────────
router.post('/message', protect, async (req, res) => {
  try {
    const { content, sessionId, subject } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: 'Message empty nahi ho sakta' });
    }

    const sid = sessionId || uuidv4();

    // Get last 10 messages for context
    const history = await ChatMessage.find({ userId: req.user._id, sessionId: sid })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const messages = history
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

    messages.push({ role: 'user', content });

    // RAG: retrieve relevant context
    const contextChunks = await retrieveRelevantChunks({
      userId: req.user._id,
      query: content,
      subject: subject || null,
      topK: 5,
    });

    // Get AI response
    const { content: reply, tokensUsed } = await chat({
      messages,
      user: req.user,
      contextChunks,
    });

    // Save user message
    await ChatMessage.create({
      userId: req.user._id,
      sessionId: sid,
      role: 'user',
      content,
    });

    let youtubeId = null;
    let cleanedReply = reply;
    const ytMatch = reply.match(/\[YT_PLAY:\s*(.+?)\]/i);
    if (ytMatch) {
      const query = ytMatch[1].trim();
      cleanedReply = reply.replace(/\[YT_PLAY:\s*(.+?)\]/i, '').trim();
      youtubeId = await searchYouTube(query);
    }

    // Save assistant message
    const assistantMsg = await ChatMessage.create({
      userId: req.user._id,
      sessionId: sid,
      role: 'assistant',
      content: cleanedReply,
      youtubeId,
      usedRAG: contextChunks.length > 0,
      sources: contextChunks.map((c) => ({
        fileName: c.metadata?.fileName,
        subject: c.subject,
        chunkText: c.chunkText.substring(0, 200),
      })),
      tokensUsed,
    });

    res.json({
      success: true,
      sessionId: sid,
      message: assistantMsg,
      reply: cleanedReply,
      usedRAG: contextChunks.length > 0,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, message: 'Kuch toh gadbad ho gayi — thodi der baad try kar', error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/history — Get chat history
// ─────────────────────────────────────────────
router.get('/history', protect, async (req, res) => {
  try {
    const { sessionId, page = 1, limit = 30 } = req.query;

    const filter = { userId: req.user._id };
    if (sessionId) filter.sessionId = sessionId;

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    res.json({ success: true, messages: messages.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/sessions — List all sessions
// ─────────────────────────────────────────────
router.get('/sessions', protect, async (req, res) => {
  try {
    const sessions = await ChatMessage.aggregate([
      { $match: { userId: req.user._id } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$sessionId',
          lastMessage: { $first: '$content' },
          lastRole: { $first: '$role' },
          lastTime: { $first: '$createdAt' },
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { lastTime: -1 } },
      { $limit: 20 },
    ]);

    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/chat/session/:sessionId — Clear a session
// ─────────────────────────────────────────────
router.delete('/session/:sessionId', protect, async (req, res) => {
  try {
    await ChatMessage.deleteMany({ userId: req.user._id, sessionId: req.params.sessionId });
    res.json({ success: true, message: 'Session clear ho gaya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
