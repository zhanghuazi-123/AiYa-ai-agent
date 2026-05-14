// Simple keyword extraction from Chinese + English text
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '什么', '怎么', '如何', '可以',
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can','shall',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your',
  'his','its','our','their','this','that','these','those','to','of','in','for',
  'on','with','at','by','from','as','into','through','during','before','after',
  'and','but','or','not','no','if','so','than','too','very','just','now','then',
]);

export function extractKeywords(text = '', max = 8) {
  if (!text) return [];
  const cleaned = text.replace(/[^\w\u4e00-\u9fff\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // Bigram + trigram Chinese extraction
  const chineseChars = cleaned.replace(/[^\u4e00-\u9fff]/g, '');
  const words = new Map();

  // Chinese bigrams
  for (let i = 0; i < chineseChars.length - 1; i++) {
    const bigram = chineseChars.slice(i, i + 2);
    if (!STOP_WORDS.has(bigram)) {
      words.set(bigram, (words.get(bigram) || 0) + 1);
    }
  }
  // Chinese trigrams
  for (let i = 0; i < chineseChars.length - 2; i++) {
    const trigram = chineseChars.slice(i, i + 3);
    words.set(trigram, (words.get(trigram) || 0) + 1);
  }

  // English words
  const englishWords = cleaned.match(/[a-zA-Z]{3,}/g) || [];
  for (const w of englishWords) {
    const lower = w.toLowerCase();
    if (!STOP_WORDS.has(lower)) {
      words.set(lower, (words.get(lower) || 0) + 1);
    }
  }

  // Score by frequency * length
  const scored = [...words.entries()]
    .map(([w, f]) => ({ word: w, score: f * w.length }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map(s => s.word);
}

// Format a timestamp into a human-friendly TICK description
export function formatTick() {
  const now = new Date();
  const iso = now.toISOString();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = dayNames[now.getDay()];
  const hour = now.getHours();
  const timeOfDay = hour < 6 ? 'late night' : hour < 9 ? 'early morning' : hour < 12 ? 'morning' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  return `TICK ${iso} | ${day} ${timeOfDay}`;
}

export function formatEntityTimeDesc(createdAt) {
  if (!createdAt) return '';
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now - created;
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
