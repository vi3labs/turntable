const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

// Simple in-memory cache for search results (1 hour TTL)
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}

// Run cache cleanup every 10 minutes
setInterval(cleanCache, 10 * 60 * 1000);

export async function searchVideos(query, maxResults = 10) {
  if (!YOUTUBE_API_KEY) {
    return { error: 'YouTube API key not configured' };
  }

  // Check cache
  const cacheKey = `${query}:${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10', // Music
      videoEmbeddable: 'true',
      maxResults: maxResults.toString(),
      key: YOUTUBE_API_KEY
    });

    const response = await fetch(`${BASE_URL}/search?${params}`);
    const data = await response.json();

    if (data.error) {
      return { error: data.error.message };
    }

    if (!data.items || data.items.length === 0) return [];

    // Get durations (search endpoint doesn't include them)
    const videoIds = data.items.map(i => i.id.videoId).join(',');
    const detailParams = new URLSearchParams({
      part: 'contentDetails,snippet',
      id: videoIds,
      key: YOUTUBE_API_KEY
    });

    const detailResponse = await fetch(`${BASE_URL}/videos?${detailParams}`);
    const detailData = await detailResponse.json();

    const results = (detailData.items || []).map(item => ({
      videoId: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      duration: parseDuration(item.contentDetails.duration)
    }));

    // Cache results
    searchCache.set(cacheKey, { results, timestamp: Date.now() });

    return results;
  } catch (err) {
    return { error: err.message };
  }
}

export async function getVideoInfo(videoId) {
  if (!YOUTUBE_API_KEY) {
    return { error: 'YouTube API key not configured' };
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: videoId,
      key: YOUTUBE_API_KEY
    });

    const response = await fetch(`${BASE_URL}/videos?${params}`);
    const data = await response.json();

    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    return {
      videoId: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      duration: parseDuration(item.contentDetails.duration)
    };
  } catch (err) {
    return null;
  }
}

export function extractVideoId(input) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/ // Bare video ID
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  return h * 3600 + m * 60 + s;
}
