const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ChatMessage = require('../models/ChatMessage');
const { streamChat } = require('../services/openaiService');
const { retrieveRelevantChunks } = require('../services/ragService');
const { transcribeAudio } = require('../services/openaiService');
const { v4: uuidv4 } = require('uuid');
const { searchYouTube } = require('../services/youtubeService');

module.exports = (io) => {
  // ─────────────────────────────────────────────
  // Auth middleware for Socket.IO
  // ─────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error — token nahi mila'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new Error('User nahi mila'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Token invalid — dobara login kar'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.user.name} (${socket.id})`);

    // Join user's personal room
    socket.join(`user_${socket.user._id}`);

    // Send welcome message
    socket.emit('connected', {
      message: `Connected! Bol bhai — kya help chahiye? 🤖`,
      userId: socket.user._id,
      userName: socket.user.name,
    });

    // ─────────────────────────────────────────────
    // EVENT: chat_message — Handle text message with streaming
    // ─────────────────────────────────────────────
    socket.on('chat_message', async ({ content, sessionId, subject }) => {
      if (!content?.trim()) return;

      const sid = sessionId || uuidv4();

      try {
        socket.emit('typing_start', { sessionId: sid });

        // Get conversation history (last 10 msgs)
        const history = await ChatMessage.find({ userId: socket.user._id, sessionId: sid })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();

        const messages = history
          .reverse()
          .map((m) => ({ role: m.role, content: m.content }));

        messages.push({ role: 'user', content });

        // Save user message first
        await ChatMessage.create({
          userId: socket.user._id,
          sessionId: sid,
          role: 'user',
          content,
        });

        // Emit the saved user message back for confirmation
        socket.emit('user_message_saved', { content, sessionId: sid });

        // RAG: retrieve relevant context
        const contextChunks = await retrieveRelevantChunks({
          userId: socket.user._id,
          query: content,
          subject: subject || null,
          topK: 5,
        });

        // Stream the response
        let fullContent = '';

        await streamChat({
          messages,
          user: socket.user,
          contextChunks,
          onChunk: (delta) => {
            fullContent += delta;
            socket.emit('chat_chunk', { delta, sessionId: sid });
          },
          onDone: async ({ content: finalContent, tokensUsed }) => {
            socket.emit('typing_stop', { sessionId: sid });

            let youtubeId = null;
            let cleanedContent = finalContent;
            const ytMatch = finalContent.match(/\[YT_PLAY:\s*(.+?)\]/i);
            if (ytMatch) {
              const query = ytMatch[1].trim();
              cleanedContent = finalContent.replace(/\[YT_PLAY:\s*(.+?)\]/i, '').trim();
              youtubeId = await searchYouTube(query);
            }

            // Save assistant message
            const assistantMsg = await ChatMessage.create({
              userId: socket.user._id,
              sessionId: sid,
              role: 'assistant',
              content: cleanedContent,
              youtubeId,
              usedRAG: contextChunks.length > 0,
              sources: contextChunks.slice(0, 3).map((c) => ({
                fileName: c.metadata?.fileName,
                subject: c.subject,
                chunkText: c.chunkText?.substring(0, 200),
              })),
              tokensUsed,
            });

            socket.emit('chat_done', {
              sessionId: sid,
              message: assistantMsg,
              usedRAG: contextChunks.length > 0,
              sourcesCount: contextChunks.length,
            });
          },
          onError: (error) => {
            socket.emit('typing_stop', { sessionId: sid });
            socket.emit('chat_error', {
              message: 'Kuch gadbad ho gayi — dobara bol bhai',
              error: error.message,
            });
          },
        });
      } catch (error) {
        console.error('Socket chat error:', error);
        socket.emit('typing_stop', { sessionId: sid });
        socket.emit('chat_error', { message: 'Server ne haath khade kar diye — thodi der baad try kar' });
      }
    });

    // ─────────────────────────────────────────────
    // EVENT: voice_message — Handle audio blob with streaming response
    // ─────────────────────────────────────────────
    socket.on('voice_message', async ({ audioData, sessionId, mimeType }) => {
      if (!audioData) return;

      const sid = sessionId || uuidv4();

      try {
        socket.emit('transcribing', { sessionId: sid });

        // Convert base64 audio to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');

        // Transcribe with Whisper
        const transcript = await transcribeAudio(audioBuffer, mimeType || 'audio/webm');

        if (!transcript?.trim()) {
          socket.emit('voice_error', { message: 'Audio clear nahi tha — dobara bol bhai' });
          return;
        }

        // Emit transcript so UI can show it
        socket.emit('transcript_ready', { transcript, sessionId: sid });

        // Now process as regular chat message (streaming)
        socket.emit('typing_start', { sessionId: sid });

        const history = await ChatMessage.find({ userId: socket.user._id, sessionId: sid })
          .sort({ createdAt: -1 })
          .limit(8)
          .lean();

        const messages = [
          ...history.reverse().map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: transcript },
        ];

        await ChatMessage.create({
          userId: socket.user._id,
          sessionId: sid,
          role: 'user',
          content: transcript,
        });

        const contextChunks = await retrieveRelevantChunks({
          userId: socket.user._id,
          query: transcript,
          topK: 4,
        });

        await streamChat({
          messages,
          user: socket.user,
          contextChunks,
          onChunk: (delta) => {
            socket.emit('chat_chunk', { delta, sessionId: sid });
          },
          onDone: async ({ content: finalContent, tokensUsed }) => {
            socket.emit('typing_stop', { sessionId: sid });

            let youtubeId = null;
            let cleanedContent = finalContent;
            const ytMatch = finalContent.match(/\[YT_PLAY:\s*(.+?)\]/i);
            if (ytMatch) {
              const query = ytMatch[1].trim();
              cleanedContent = finalContent.replace(/\[YT_PLAY:\s*(.+?)\]/i, '').trim();
              youtubeId = await searchYouTube(query);
            }

            const assistantMsg = await ChatMessage.create({
              userId: socket.user._id,
              sessionId: sid,
              role: 'assistant',
              content: cleanedContent,
              youtubeId,
              usedRAG: contextChunks.length > 0,
              tokensUsed,
            });

            // Emit chat_done so client saves the message and updates UI/audio
            socket.emit('chat_done', {
              sessionId: sid,
              message: assistantMsg,
              usedRAG: contextChunks.length > 0,
              sourcesCount: contextChunks.length,
            });

            socket.emit('voice_response_done', {
              sessionId: sid,
              content: cleanedContent,
              youtubeId,
              transcript,
            });
          },
          onError: (error) => {
            socket.emit('typing_stop', { sessionId: sid });
            socket.emit('chat_error', { message: 'Voice response mein error aa gaya' });
          },
        });
      } catch (error) {
        console.error('Voice message error:', error);
        socket.emit('voice_error', { message: 'Voice process nahi ho paya', error: error.message });
      }
    });

    // ─────────────────────────────────────────────
    // EVENT: disconnect
    // ─────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`❌ Disconnected: ${socket.user?.name} — ${reason}`);
    });
  });
};
