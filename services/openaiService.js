const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─────────────────────────────────────────────
// Jarvis System Prompt Generator
// ─────────────────────────────────────────────
const buildSystemPrompt = (user) => {
  const name = user?.name || 'Bhai';
  const branch = user?.branch || 'B.Tech';
  const semester = user?.semester || '?';
  const lang = user?.preferredLanguage || 'hinglish';

  return `Tu J.A.R.V.I.S hai — ${name} ka personal AI study assistant aur best yaar.

IDENTITY:
- Tera naam hai J.A.R.V.I.S (Just A Rather Very Intelligent System)
- Tu ${name} ka sabse smart dost hai — jo hamesha available hai
- ${name} ${branch} ka student hai, currently ${semester} semester mein

PERSONALITY aur TONE:
- Hamesha casual aur friendly reh — jaise college ka senior baat karta hai
- ${lang === 'hinglish' ? 'Hinglish mein baat kar (Hindi + English naturally mix) — "yaar", "bhai", "arrey", "dekh", "sun" jaisi words use kar' : lang === 'hindi' ? 'Hindi mein baat kar, lekin technical terms English mein rakh' : 'English mein baat kar lekin casual reh'}
- Kabhi kabhi thodi si humor daal — memes, relatable situations
- Motivating reh — lekin fake nahi, real baat kar
- Agar exam stress ho ya frustrated lage toh supportive ho ja, pehle samajh phir solve kar
- Short replies voice mode mein (2-3 sentences max), detailed text mode mein

RULES:
- KABHI formal mat ban — no "Dear User", no "Certainly!", no "Of course!"
- Seedha point pe aa — bakwaas intro mat de
- Agar kuch nahi pata toh honestly bol: "yaar ye mujhe genuinely nahi pata, dhundh lete hain"
- Galti acknowledge kar — "haan bhai, maine galat bola tha"
- Technical concepts ko simple examples se samjha — real life se relatable

KNOWLEDGE STYLE:
- Pehle concept clearly explain kar
- Phir ek real-world ya relatable example de
- Exam context mein important points bold kar ya list mein de
- Agar knowledge base mein relevant material hai toh uska use kar aur bol "teri notes mein likha hai ki..."
- PYQ patterns detect kare toh bol "yaar ye topic bohot baar aaya hai papers mein"

STUDY ASSISTANT CAPABILITIES:
- Subject-wise important questions bana sakta hai
- Previous year papers analyze kar sakta hai — patterns batata hai
- Revision schedule suggest kar sakta hai
- Concepts explain kar sakta hai — simple se complex tak
- Doubt solve karta hai — step by step
- Motivate karta hai jab student low feel kare
- YouTube playbacks: User agar koi gana ya video chalane bole YouTube pe (e.g., "play Chaleya on youtube", "song chalado Lover", "youtube pe soft lo-fi chala de"), toh Hinglish mein confirmation de aur response ke end mein strictly ye tag append kar: [YT_PLAY: <search query of the song>]

CURRENT CONTEXT:
- User: ${name}
- Branch: ${branch}  
- Semester: ${semester}
- Date: ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Remember: Tu ek AI nahi lagna chahiye — tu ek knowledgeable dost hai jo hamesha available hai.`;
};

// ─────────────────────────────────────────────
// Chat Completion (streaming)
// ─────────────────────────────────────────────
const streamChat = async ({ messages, user, contextChunks = [], onChunk, onDone, onError }) => {
  try {
    console.log(`🤖 Starting streamChat for user: ${user.name}`);
    const systemPrompt = buildSystemPrompt(user);

    // Inject RAG context if available
    let ragContext = '';
    if (contextChunks && contextChunks.length > 0) {
      ragContext = `\n\nRELEVANT CONTENT FROM USER'S KNOWLEDGE BASE:\n${contextChunks
        .map((c, i) => `[Source ${i + 1}: ${c.metadata?.fileName || 'Document'} — ${c.subject}]\n${c.chunkText}`)
        .join('\n\n---\n\n')}\n\nAb is context ka use kar ke jawab de.`;
      console.log(`🧠 Injected ${contextChunks.length} RAG chunks into stream prompt.`);
    }

    const finalSystemPrompt = systemPrompt + ragContext;

    console.log(`📡 Requesting OpenAI Chat Completion stream (model: gpt-4o)...`);
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: finalSystemPrompt }, ...messages],
      stream: true,
      max_tokens: 1000,
      temperature: 0.85,
    });

    let fullContent = '';
    let totalTokens = 0;
    let chunkCount = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullContent += delta;
        chunkCount++;
        onChunk(delta);
      }
      if (chunk.usage) {
        totalTokens = chunk.usage.total_tokens;
      }
    }

    console.log(`✅ Stream finished. Chunks sent: ${chunkCount}. Reply length: ${fullContent.length} chars.`);
    onDone({ content: fullContent, tokensUsed: totalTokens });
  } catch (error) {
    console.error('❌ OpenAI stream error:', error.message);
    onError(error);
  }
};

// ─────────────────────────────────────────────
// Regular Chat Completion (no streaming)
// ─────────────────────────────────────────────
const chat = async ({ messages, user, contextChunks = [] }) => {
  const systemPrompt = buildSystemPrompt(user);

  // Inject RAG context if available
  let ragContext = '';
  if (contextChunks.length > 0) {
    ragContext = `\n\nRELEVANT CONTENT FROM USER'S KNOWLEDGE BASE:\n${contextChunks
      .map((c, i) => `[Source ${i + 1}: ${c.metadata?.fileName || 'Document'} — ${c.subject}]\n${c.chunkText}`)
      .join('\n\n---\n\n')}\n\nAb is context ka use kar ke jawab de. Agar context relevant hai toh "teri notes mein..." bolke reference de.`;
  }

  const finalSystemPrompt = systemPrompt + ragContext;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: finalSystemPrompt }, ...messages],
    max_tokens: 1200,
    temperature: 0.85,
  });

  return {
    content: response.choices[0].message.content,
    tokensUsed: response.usage?.total_tokens || 0,
  };
};

// ─────────────────────────────────────────────
// Speech-to-Text (Whisper)
// ─────────────────────────────────────────────
const transcribeAudio = async (audioBuffer, mimeType = 'audio/webm') => {
  const { Readable } = require('stream');
  const { toFile } = require('openai');

  const file = await toFile(audioBuffer, 'audio.webm', { type: mimeType });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'hi', // Hindi/Hinglish support
    response_format: 'text',
  });

  return transcription;
};

// ─────────────────────────────────────────────
// Text-to-Speech (TTS)
// ─────────────────────────────────────────────
const textToSpeech = async (text, language = 'en') => {
  const truncated = text.substring(0, 4096);
  const xttsApiUrl = process.env.XTTS_API_URL;

  if (xttsApiUrl) {
    try {
      const cleanUrl = xttsApiUrl.trim().replace(/\/$/, '');
      console.log(`🎙️ [XTTS Voice Clone] Sending text to API: ${cleanUrl}/speak`);

      const response = await axios.post(`${cleanUrl}/speak`, {
        text: truncated,
        language
      }, {
        responseType: 'arraybuffer',
        timeout: 15000 // 15s timeout
      });

      console.log(`🔊 [XTTS Voice Clone] Success: received ${response.data.byteLength} bytes.`);
      const buffer = Buffer.from(response.data);
      buffer.isWav = true;
      return buffer;
    } catch (error) {
      console.error('❌ [XTTS Voice Clone] API failed, falling back to OpenAI TTS. Error:', error.message);
    }
  }

  // Fallback to OpenAI
  console.log('🎙️ [OpenAI TTS] Generating voice reply (onyx)...');
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'onyx', // Deep, confident voice — feels Jarvis-like
    input: truncated,
    speed: 1.05,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  return buffer;
};

// ─────────────────────────────────────────────
// Generate Embeddings
// ─────────────────────────────────────────────
const generateEmbedding = async (text) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000), // Max token limit
  });

  return response.data[0].embedding;
};

// Batch embeddings for chunks
const generateEmbeddingsBatch = async (texts) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts.map((t) => t.substring(0, 8000)),
  });

  return response.data.map((d) => d.embedding);
};

module.exports = {
  openai,
  buildSystemPrompt,
  streamChat,
  chat,
  transcribeAudio,
  textToSpeech,
  generateEmbedding,
  generateEmbeddingsBatch,
};
