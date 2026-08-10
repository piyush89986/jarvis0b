const axios = require('axios');

/**
 * Searches YouTube for the given query and returns the video ID of the first result.
 * @param {string} query - The search query (e.g. "Chaleya song").
 * @returns {Promise<string|null>} - The video ID or null if not found.
 */
async function searchYouTube(query) {
  if (!query?.trim()) return null;
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    console.log(`🔍 [youtubeService] Searching YouTube: "${query}"`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 6000 // 6 seconds timeout
    });
    
    const html = response.data;
    
    // Look for videoId patterns in the initial data JSON script
    const regex = /"videoIds":\s*\[\s*"([^"]+)"/g;
    const match = regex.exec(html);
    if (match && match[1]) {
      console.log(`✅ [youtubeService] Found video ID via videoIds array: ${match[1]}`);
      return match[1];
    }
    
    // Fallback: search for /watch?v=...
    const watchRegex = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
    let watchMatch;
    while ((watchMatch = watchRegex.exec(html)) !== null) {
      const id = watchMatch[1];
      console.log(`✅ [youtubeService] Found video ID via fallback watch url: ${id}`);
      return id;
    }
    
    console.log(`⚠️ [youtubeService] No video ID found for query: "${query}"`);
    return null;
  } catch (err) {
    console.error('❌ [youtubeService] Search error:', err.message);
    return null;
  }
}

module.exports = { searchYouTube };
