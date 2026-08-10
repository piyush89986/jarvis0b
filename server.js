require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
require('./config/cloudinary'); // Initialize cloudinary

const app = express();
const server = http.createServer(app);

// ─────────────────────────────────────────────
// Socket.IO setup
// ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true), // Allow any origin dynamically for mobile testing/Vercel
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 25e6, // 25MB for audio/file data
});

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => callback(null, true), // Allow any origin dynamically
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'J.A.R.V.I.S server is alive 🤖', timestamp: new Date() });
});


// 404 handler — catch all unmatched routes
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} nahi mila bhai` });
});



// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─────────────────────────────────────────────
// Socket.IO handler
// ─────────────────────────────────────────────
require('./socket/socketHandler')(io);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  🤖 J.A.R.V.I.S Server Online!        ║
║  Port: ${PORT}                            ║
║  Mode: ${process.env.NODE_ENV || 'development'}                   ║
╚════════════════════════════════════════╝
    `);
  });
});
