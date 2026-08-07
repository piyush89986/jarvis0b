const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { uploadAudio } = require('../middleware/upload');
const { transcribeAudio, textToSpeech } = require('../services/openaiService');

// ─────────────────────────────────────────────
// POST /api/voice/transcribe — Audio → Text (Whisper)
// ─────────────────────────────────────────────
router.post('/transcribe', protect, (req, res) => {
  uploadAudio(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Audio file nahi mili' });
      }

      console.log(`🎤 Transcribing audio: ${req.file.size} bytes, ${req.file.mimetype}`);
      const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);

      res.json({
        success: true,
        transcript,
        duration: req.file.size / 16000, // Rough estimate
      });
    } catch (error) {
      console.error('Transcription error:', error);
      res.status(500).json({ success: false, message: 'Audio samajh nahi aaya — dobara bol', error: error.message });
    }
  });
});

// ─────────────────────────────────────────────
// POST /api/voice/speak — Text → Audio (TTS)
// ─────────────────────────────────────────────
router.post('/speak', protect, async (req, res) => {
  try {
    const { text, voice = 'onyx' } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: 'Text do bhai — kya bolun?' });
    }

    const audioBuffer = await textToSpeech(text);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache',
    });

    res.send(audioBuffer);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ success: false, message: 'Bol nahi paya — thodi der baad try kar', error: error.message });
  }
});

module.exports = router;
