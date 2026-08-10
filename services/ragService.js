const KnowledgeChunk = require('../models/KnowledgeChunk');
const { generateEmbedding, generateEmbeddingsBatch } = require('./openaiService');

// ─────────────────────────────────────────────
// Chunk text into smaller pieces with overlap
// ─────────────────────────────────────────────
const chunkText = (text, chunkSize = 500, overlap = 50) => {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) {
      // Skip tiny chunks
      chunks.push(chunk.trim());
    }
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
};

// ─────────────────────────────────────────────
// Process and store a document in the knowledge base
// ─────────────────────────────────────────────
const processAndStoreDocument = async ({ userId, fileId, subject, extractedText, metadata }) => {
  try {
    console.log(`🧠 Processing document for RAG: ${metadata.fileName}`);

    // 1. Chunk the text
    const chunks = chunkText(extractedText);
    console.log(`📦 Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error('No text could be extracted from this file');
    }

    // 2. Generate embeddings in batches of 20 (API limit consideration)
    const batchSize = 20;
    const allEmbeddings = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      console.log(`🔢 Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}`);
      const embeddings = await generateEmbeddingsBatch(batch);
      allEmbeddings.push(...embeddings);
    }

    // 3. Build and insert all chunk documents
    const chunkDocs = chunks.map((chunkText, index) => ({
      userId,
      fileId,
      subject,
      chunkText,
      chunkIndex: index,
      embedding: allEmbeddings[index],
      metadata: {
        ...metadata,
        tags: metadata.tags || [],
      },
    }));

    await KnowledgeChunk.insertMany(chunkDocs);
    console.log(`✅ Stored ${chunkDocs.length} chunks in knowledge base`);

    return { chunksCreated: chunkDocs.length };
  } catch (error) {
    console.error('RAG processing error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────
// Retrieve relevant chunks for a query (RAG)
// Uses MongoDB Atlas Vector Search
// ─────────────────────────────────────────────
const retrieveRelevantChunks = async ({ userId, query, subject = null, topK = 5 }) => {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // MongoDB Atlas Vector Search pipeline
    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: 50,
          limit: topK,
          filter: subject
            ? { userId: userId.toString(), subject }
            : { userId: userId.toString() },
        },
      },
      {
        $project: {
          chunkText: 1,
          subject: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    const chunks = await KnowledgeChunk.aggregate(pipeline);

    // Filter by minimum relevance score
    const relevantChunks = chunks.filter((c) => c.score > 0.6);
    console.log(`🔍 Retrieved ${relevantChunks.length} relevant chunks (min score 0.6)`);

    return relevantChunks;
  } catch (error) {
    // If Atlas vector search not set up yet, fall back to text search
    if (error.message?.includes('$vectorSearch')) {
      console.warn('⚠️  Atlas Vector Search not configured yet — using text fallback');
      return await fallbackTextSearch({ userId, query, subject, topK });
    }
    console.error('RAG retrieval error:', error.message);
    return [];
  }
};

// Fallback: simple text search when vector index not set up
const fallbackTextSearch = async ({ userId, query, subject, topK }) => {
  const filter = { userId };
  if (subject) filter.subject = subject;

  // Simple keyword match fallback
  const keywords = query.split(/\s+/).slice(0, 5);
  filter.chunkText = { $regex: keywords.join('|'), $options: 'i' };

  return await KnowledgeChunk.find(filter)
    .select('chunkText subject metadata')
    .limit(topK)
    .lean();
};

// ─────────────────────────────────────────────
// Delete all chunks for a file
// ─────────────────────────────────────────────
const deleteFileChunks = async (fileId) => {
  const result = await KnowledgeChunk.deleteMany({ fileId });
  return result.deletedCount;
};

// ─────────────────────────────────────────────
// Get subjects list for a user
// ─────────────────────────────────────────────
const getUserSubjects = async (userId) => {
  const subjects = await KnowledgeChunk.distinct('subject', { userId });
  return subjects;
};

// ─────────────────────────────────────────────
// Save chat exchange to memory in the knowledge base
// ─────────────────────────────────────────────
const saveChatToMemory = async ({ userId, userMessage, assistantMessage }) => {
  if (!userMessage?.trim() || !assistantMessage?.trim()) return;
  try {
    const textBlock = `User: ${userMessage.trim()}\nJarvis: ${assistantMessage.trim()}`;
    
    const KnowledgeFile = require('../models/KnowledgeFile');
    
    let memoryFile = await KnowledgeFile.findOne({ userId, originalName: 'Chat Memory' });
    if (!memoryFile) {
      memoryFile = await KnowledgeFile.create({
        userId,
        originalName: 'Chat Memory',
        cloudinaryUrl: 'local',
        cloudinaryPublicId: 'local',
        fileType: 'txt',
        subject: 'General',
        status: 'processed',
      });
    }

    const embedding = await generateEmbedding(textBlock);

    await KnowledgeChunk.create({
      userId,
      fileId: memoryFile._id,
      subject: 'General',
      chunkText: textBlock,
      embedding,
      metadata: {
        fileName: 'Chat Memory',
        fileType: 'txt',
      },
    });

    console.log(`🧠 [Memory] Saved chat exchange to user knowledge base: "${userMessage.substring(0, 30)}..."`);
  } catch (err) {
    console.error('❌ [Memory] Failed to save chat to memory:', err.message);
  }
};

module.exports = {
  chunkText,
  processAndStoreDocument,
  retrieveRelevantChunks,
  deleteFileChunks,
  getUserSubjects,
  saveChatToMemory,
};
