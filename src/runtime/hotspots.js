import { getConfig, setConfig } from '../db.js';

const CACHE_TTL_MS = 15 * 60 * 1000;
const CONTEXT_TTL_MS = 60 * 60 * 1000;

let _cache = { data: null, expiresAt: 0 };
let _contextExpiresAt = 0;
let _panelViewedAt = 0;

export function noteHotspotPanelViewed() {
  _panelViewedAt = Date.now();
}

export async function getHotspots(platform = 'weibo') {
  const now = Date.now();
  if (_cache.data && _cache.data.platform === platform && now < _cache.expiresAt) {
    return _cache.data;
  }

  try {
    if (platform === 'weibo') {
      const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
        headers: { 'User-Agent': 'AiYa/1.0' },
      });
      const data = await res.json();
      const topics = (data.data?.realtime || []).slice(0, 20).map(t => ({
        title: t.word || t.note,
        hot: t.num,
        icon: t.icon_desc,
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(t.word)}`,
      }));
      _cache = { data: { platform, topics, fetchedAt: now }, expiresAt: now + CACHE_TTL_MS };
      return _cache.data;
    }

    if (platform === 'zhihu') {
      const res = await fetch('https://www.zhihu.com/api/v3/topstory/hot-lists/total?limit=20', {
        headers: { 'User-Agent': 'AiYa/1.0' },
      });
      const data = await res.json();
      const topics = (data.data || []).slice(0, 20).map(t => ({
        title: t.target?.title || t.detail_text,
        hot: t.detail_text,
        url: `https://www.zhihu.com/question/${t.target?.id || ''}`,
      }));
      _cache = { data: { platform, topics, fetchedAt: now }, expiresAt: now + CACHE_TTL_MS };
      return _cache.data;
    }
  } catch (e) {
    console.error('[Hotspots] Failed:', e.message);
  }
  return { platform, topics: [], fetchedAt: now };
}

export function getHotspotsSummary() {
  if (!_cache.data || _cache.data.topics.length === 0) return '';
  const lines = _cache.data.topics.slice(0, 5).map((t, i) => {
    const icon = t.icon ? ` [${t.icon}]` : '';
    return `${i + 1}. ${t.title}${icon}`;
  });
  return `热搜 (${_cache.data.platform}):\n${lines.join('\n')}`;
}

export function buildHotspotRuntimeContext(message) {
  const now = Date.now();
  const panelRecentlyViewed = now - _panelViewedAt < CONTEXT_TTL_MS;
  const cacheFresh = _cache.data && now < _cache.expiresAt;

  if (!panelRecentlyViewed && !cacheFresh) return '';
  if (!_cache.data || _cache.data.topics.length === 0) return '';

  // Check if message matches any hotspot
  let matched = [];
  if (message) {
    for (const t of _cache.data.topics) {
      if (t.title && message.includes(t.title)) matched.push(t);
    }
  }

  if (matched.length === 0 && !panelRecentlyViewed) return '';

  let text = '## Hotspot Context\n';
  if (matched.length > 0) {
    text += `用户提到的热搜: ${matched.map(t => t.title).join('、')}\n`;
  }
  if (panelRecentlyViewed || matched.length === 0) {
    text += '当前热搜:\n';
    _cache.data.topics.slice(0, 10).forEach((t, i) => {
      text += `  ${i + 1}. ${t.title}${t.hot ? ` (热度:${t.hot})` : ''}\n`;
    });
  }
  return text;
}

export async function persistHotspotAsMemory(topic) {
  // Auto-archive matched hotspot as memory
  try {
    const db = await import('../db.js');
    const hash = Buffer.from(topic.title).toString('base64').slice(0, 8);
    db.upsertMemoryByMemId(`hotspot_${hash}`, {
      type: 'fact',
      content: `热搜: ${topic.title}`,
      detail: topic.hot ? `热度: ${topic.hot}` : '',
      title: topic.title,
      tags: ['hotspot', _cache.data?.platform || ''],
      timestamp: new Date().toISOString(),
    });
  } catch {}
}
