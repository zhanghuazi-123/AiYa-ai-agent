// TTS Provider implementations based on BaiLongma architecture
import { getConfig, setConfig } from '../db.js';

const DOUBAO_DEFAULT_KEY = '1f6b87e7-293f-47ab-aac5-68e3fed3b9e2';

function resolveDoubaoResourceId(voiceId, resourceId) {
  if (resourceId) return resourceId;
  // Common resource IDs for Doubao voices
  if (voiceId?.includes('xiaohe')) return 'volc.bigmodel.tts.standard';
  if (voiceId?.includes('uranus')) return 'volc.bigmodel.tts.standard';
  return 'volc.bigmodel.tts.standard';
}

async function decodeDoubaoStream(body) {
  // Doubao v3 returns JSON lines with base64 audio chunks
  const reader = body.getReader();
  const chunks = [];
  let buffer = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.audio) {
          chunks.push(Buffer.from(data.audio, 'base64'));
        }
        if (data.code && data.code !== 3000) {
          throw new Error(`Doubao error: ${data.message || data.code}`);
        }
      } catch (e) {
        if (e.message?.includes('Doubao')) throw e;
      }
    }
  }
  return Buffer.concat(chunks);
}

export async function synthesizeSpeech(text, options = {}) {
  const provider = options.ttsProvider || getConfig('tts_provider') || 'doubao';
  const voiceId = options.ttsVoiceId || getConfig('tts_voice') || 'zh_female_xiaohe_uranus_bigtts';
  const apiKey = options.ttsKey || getConfig('tts_doubao_key') || DOUBAO_DEFAULT_KEY;

  switch (provider) {
    case 'doubao':
      return doubaoTTS(text, voiceId, apiKey);
    case 'minimax':
      return minimaxTTS(text, voiceId, apiKey);
    case 'openai':
      return openaiTTS(text, voiceId, apiKey);
    default:
      return doubaoTTS(text, voiceId, apiKey);
  }
}

async function doubaoTTS(text, voiceId, apiKey) {
  // Try Volcano engine v1 API (more compatible with bearer tokens)
  try {
    return await volcanoTTS(text, voiceId, apiKey);
  } catch (e) {
    // Fallback to v3 Doubao API
    return await doubaoV3TTS(text, voiceId, apiKey);
  }
}

async function volcanoTTS(text, voiceId, token) {
  const body = {
    app: { appid: '6583036926', token, cluster: 'volcano_tts' },
    user: { uid: 'aiya_user' },
    audio: {
      voice_type: voiceId,
      encoding: 'mp3',
      speed_ratio: 1.0,
    },
    request: { reqid: Date.now().toString(), text: text.slice(0, 800), text_type: 'plain', operation: 'query' },
  };

  const res = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer; ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown');
    throw new Error(`Volcano TTS: HTTP ${res.status} - ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.code !== 3000) throw new Error(`Volcano TTS error: ${data.message || data.code}`);
  return Buffer.from(data.data, 'base64');
}

async function doubaoV3TTS(text, voiceId, apiKey) {
  const resourceId = resolveDoubaoResourceId(voiceId, null);
  const headers = {
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': `aiya_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const resp = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user: { uid: 'aiya_user' },
      req_params: {
        text: text.slice(0, 800),
        speaker: voiceId,
        audio_params: { format: 'mp3', sample_rate: 24000 },
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => 'Unknown');
    throw new Error(`Doubao v3: HTTP ${resp.status} - ${err.slice(0, 200)}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('audio/')) {
    return Buffer.from(await resp.arrayBuffer());
  }
  return decodeDoubaoStream(resp.body);
}

async function minimaxTTS(text, voiceId, apiKey) {
  const res = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'speech-01',
      text: text.slice(0, 800),
      voice_setting: { voice_id: voiceId || 'male-qn-qingse' },
      audio_setting: { format: 'mp3', sample_rate: 24000 },
    }),
  });
  if (!res.ok) throw new Error(`MiniMax TTS failed: ${res.status}`);
  const data = await res.json();
  if (data.base_resp?.status_code !== 0) throw new Error(`MiniMax TTS: ${data.base_resp?.status_msg}`);
  return Buffer.from(data.data.audio, 'hex');
}

async function openaiTTS(text, voiceId = 'alloy', apiKey) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text.slice(0, 800),
      voice: voiceId,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const TTS_VOICES = {
  doubao: [
    { id: 'zh_female_xiaohe_uranus_bigtts', name: 'XiaoHe (Female)' },
    { id: 'zh_male_uranus_bigtts', name: 'Uranus (Male)' },
  ],
  minimax: [
    { id: 'male-qn-qingse', name: 'QingSe (Male)' },
    { id: 'female-shaonv', name: 'ShaoNv (Female)' },
  ],
  openai: [
    { id: 'alloy', name: 'Alloy' },
    { id: 'echo', name: 'Echo' },
    { id: 'nova', name: 'Nova' },
    { id: 'shimmer', name: 'Shimmer' },
  ],
};
