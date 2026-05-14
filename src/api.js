import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { streamTTS, TTS_VOICES } from './voice/tts-providers.js';
import { createCloudASRSession } from './voice/cloud-asr.js';
import { getTTSCredentials } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const UI_DIR = PROJECT_ROOT; // index.html is at project root

let eventClients = [];
let wsClients = [];

function parseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

function serveFile(res, filePath, contentType = 'text/html') {
  try {
    if (!existsSync(filePath)) { res.writeHead(404); res.end('Not Found'); return; }
    const content = readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  } catch { res.writeHead(500); res.end('Server Error'); }
}

// === SSE ===

export function emitSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of eventClients) {
    try { res.write(payload); } catch { eventClients = eventClients.filter(c => c !== res); }
  }
}

// === WebSocket ===
export function broadcastWS(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch {}
  }
}

export function createAPI({ getStatus, getQuotaStatus, getMemoryCount, getAgentName,
  getSettings, onMessage, onActivate, onAdminStop, onAdminStart, onAdminRestart }) {

  const server = createServer(async (req, res) => {
    // CORS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Read body
    let body = '';
    if (req.method === 'POST' || req.method === 'PATCH') {
      body = await new Promise(resolve => {
        let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
      });
    }

    // === API Routes ===
    if (path === '/status') return sendJSON(res, 200, { ok: true, memory_count: getMemoryCount(), running: getStatus() });

    if (path === '/agent-profile') return sendJSON(res, 200, { name: getAgentName() });

    if (path === '/quota') return sendJSON(res, 200, getQuotaStatus());

    if (path === '/activation-status') return sendJSON(res, 200, getSettings());

    if (path === '/settings') return sendJSON(res, 200, getSettings());

    if (path === '/memories') {
      const { getMemories, searchMemories } = await import('./db.js');
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      const search = url.searchParams.get('search');
      const mems = search ? searchMemories(search, limit) : getMemories(limit);
      return sendJSON(res, 200, mems);
    }

    if (path.startsWith('/memories/') && req.method === 'DELETE') {
      const id = parseInt(path.split('/')[2]);
      const { deleteMemory } = await import('./db.js');
      deleteMemory(id);
      return sendJSON(res, 200, { ok: true });
    }

    if (path.startsWith('/memories/') && req.method === 'PATCH') {
      const id = parseInt(path.split('/')[2]);
      const data = parseJSON(body);
      if (data) {
        const { updateMemory } = await import('./db.js');
        updateMemory(id, data);
      }
      return sendJSON(res, 200, { ok: true });
    }

    if (path === '/conversations') {
      const { getConversations } = await import('./db.js');
      const limit = parseInt(url.searchParams.get('limit')) || 60;
      return sendJSON(res, 200, getConversations(limit));
    }

    if (path === '/message' && req.method === 'POST') {
      const data = parseJSON(body);
      if (!data || !data.content) return sendJSON(res, 400, { error: 'content required' });
      const result = await onMessage(data);
      return sendJSON(res, 200, result);
    }

    if (path === '/activate' && req.method === 'POST') {
      const data = parseJSON(body);
      if (!data || !data.apiKey) return sendJSON(res, 400, { error: 'apiKey required' });
      try {
        const result = await onActivate(data);
        return sendJSON(res, 200, result);
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }

    if (path === '/admin/stop') { onAdminStop(); return sendJSON(res, 200, { ok: true }); }
    if (path === '/admin/start') { onAdminStart(); return sendJSON(res, 200, { ok: true }); }
    if (path === '/admin/restart') { onAdminRestart(); return sendJSON(res, 200, { ok: true }); }

    if (path === '/admin/reset-memories') {
      const { getDB } = await import('./db.js');
      const db = getDB();
      db.exec("DELETE FROM memories; DELETE FROM memories_fts; DELETE FROM conversations;");
      return sendJSON(res, 200, { ok: true });
    }

    // === TTS (proxy to Bailongma Doubao TTS) ===
    if (path === '/tts' && req.method === 'POST') {
      const data = parseJSON(body);
      if (!data || !data.text) return sendJSON(res, 400, { error: 'text required' });
      try {
        const { getConfig } = await import('./db.js');
        const voiceId = data.voiceId || getConfig('tts_voice') || 'zh_female_xiaohe_uranus_bigtts';
        const ttsRes = await fetch('http://127.0.0.1:3722/tts/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.text, voiceId }),
        });
        if (!ttsRes.ok) throw new Error(`TTS ${ttsRes.status}`);
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
        res.end(audioBuffer);
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return;
    }

    if (path === '/tts/voices') {
      return sendJSON(res, 200, TTS_VOICES);
    }

    // === TTS Streaming — POST /tts/stream ===
    if (path === '/tts/stream' && req.method === 'POST') {
      const data = parseJSON(body);
      if (!data || !data.text) return sendJSON(res, 400, { error: 'text required' });
      try {
        const creds = getTTSCredentials();
        const audioStream = await streamTTS({
          text: data.text.slice(0, 800),
          provider: creds.provider,
          voiceId: data.voiceId || creds.voiceId || undefined,
          keys: {
            doubaoKey: creds.doubaoKey,
            doubaoAppId: creds.doubaoAppId,
            doubaoAccessKey: creds.doubaoAccessKey,
            doubaoResourceId: creds.doubaoResourceId,
            minimaxKey: creds.minimaxKey,
            openaiKey: creds.openaiKey,
            openaiBaseURL: creds.openaiBaseURL,
            elevenLabsKey: creds.elevenLabsKey,
            volcanoAppId: creds.volcanoAppId,
            volcanoToken: creds.volcanoToken,
          },
        });
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        audioStream.pipe(res);
        audioStream.on('error', () => { try { res.end() } catch {} });
      } catch (err) {
        console.warn('[TTS] 流式合成失败:', err.message);
        if (!res.headersSent) sendJSON(res, 500, { error: err.message });
        else try { res.end() } catch {};
      }
      return;
    }

    // === Voice Settings ===
    if (path === '/settings/voice' && req.method === 'POST') {
      const data = parseJSON(body);
      if (data) {
        const { setConfig } = await import('./db.js');
        if (data.asrProvider) setConfig('asr_provider', data.asrProvider);
        if (data.asrKey) setConfig('asr_key', data.asrKey);
        if (data.doubaoAppId) setConfig('doubao_app_id', data.doubaoAppId);
        if (data.doubaoAccessToken) setConfig('doubao_access_token', data.doubaoAccessToken);
        if (data.doubaoResourceId) setConfig('doubao_resource_id', data.doubaoResourceId);
        if (data.ttsProvider) setConfig('tts_provider', data.ttsProvider);
        if (data.ttsKey) setConfig('tts_doubao_key', data.ttsKey);
        if (data.ttsVoice) setConfig('tts_voice', data.ttsVoice);
        // TTS provider-specific credentials
        if (data.ttsDoubaoAppId) setConfig('tts_doubao_app_id', data.ttsDoubaoAppId);
        if (data.ttsDoubaoAccessKey) setConfig('tts_doubao_access_key', data.ttsDoubaoAccessKey);
        if (data.ttsDoubaoResourceId) setConfig('tts_doubao_resource_id', data.ttsDoubaoResourceId);
        if (data.ttsOpenaiKey) setConfig('tts_openai_key', data.ttsOpenaiKey);
        if (data.ttsOpenaiBaseUrl) setConfig('tts_openai_base_url', data.ttsOpenaiBaseUrl);
        if (data.ttsMinimaxKey) setConfig('tts_minimax_key', data.ttsMinimaxKey);
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (path === '/settings/voice') {
      const { getConfig } = await import('./db.js');
      return sendJSON(res, 200, {
        asrProvider: getConfig('asr_provider') || 'none',
        doubaoAppId: getConfig('doubao_app_id') || '',
        doubaoAccessToken: getConfig('doubao_access_token') ? '***已配置***' : '',
        doubaoResourceId: getConfig('doubao_resource_id') || 'volc.bigasr.sauc.duration',
        ttsProvider: getConfig('tts_provider') || 'doubao',
        ttsVoice: getConfig('tts_voice') || 'zh_female_xiaohe_uranus_bigtts',
        // TTS credential statuses
        ttsKey: getConfig('tts_doubao_key') ? '***已配置***' : '',
        ttsDoubaoAppId: getConfig('tts_doubao_app_id') || '',
        ttsDoubaoAccessKey: getConfig('tts_doubao_access_key') ? '***已配置***' : '',
        ttsDoubaoResourceId: getConfig('tts_doubao_resource_id') || '',
        ttsOpenaiKey: getConfig('tts_openai_key') ? '***已配置***' : '',
        ttsOpenaiBaseUrl: getConfig('tts_openai_base_url') || '',
        ttsMinimaxKey: getConfig('tts_minimax_key') ? '***已配置***' : '',
      });
    }

    // === Context Settings ===
    if (path === '/settings/context' && req.method === 'POST') {
      const data = parseJSON(body);
      if (data) {
        const { setConfig } = await import('./db.js');
        if (data.weatherEnabled !== undefined) setConfig('context_weather_enabled', data.weatherEnabled ? '1' : '0');
        if (data.hotspotsEnabled !== undefined) setConfig('context_hotspots_enabled', data.hotspotsEnabled ? '1' : '0');
        if (data.hotspotPlatform) setConfig('hotspot_platform', data.hotspotPlatform);
        if (data.city) setConfig('location_city', data.city);
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (path === '/settings/context') {
      const { getConfig } = await import('./db.js');
      return sendJSON(res, 200, {
        weatherEnabled: getConfig('context_weather_enabled') !== '0',
        hotspotsEnabled: getConfig('context_hotspots_enabled') !== '0',
        hotspotPlatform: getConfig('hotspot_platform') || 'weibo',
        city: getConfig('location_city') || 'Beijing',
      });
    }

    // === Tick Interval ===
    if (path === '/settings/tick' && req.method === 'POST') {
      const data = parseJSON(body);
      if (data && data.intervalMinutes) {
        const { setConfig } = await import('./db.js');
        const mins = Math.max(1, Math.min(120, parseInt(data.intervalMinutes)));
        setConfig('tick_interval_minutes', String(mins));
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (path === '/settings/tick') {
      const { getConfig } = await import('./db.js');
      return sendJSON(res, 200, {
        intervalMinutes: parseInt(getConfig('tick_interval_minutes')) || 20,
      });
    }

    // === Tools List ===
    if (path === '/tools') {
      const { TOOL_SCHEMAS } = await import('./capabilities/schemas.js');
      const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
        name,
        description: schema.function?.description || '',
      }));
      return sendJSON(res, 200, { tools });
    }

    // === SSE ===
    if (path === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(':ok\n\n');
      eventClients.push(res);
      req.on('close', () => { eventClients = eventClients.filter(c => c !== res); });
      return;
    }

    // === Static files ===
    if (path === '/' || path === '/index.html') return serveFile(res, join(UI_DIR, 'index.html'));
    if (path === '/styles.css') return serveFile(res, join(UI_DIR, 'styles.css'), 'text/css');
    if (path === '/app.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      });
      const content = readFileSync(join(UI_DIR, 'app.js'), 'utf-8');
      res.end(content);
      return;
    }
    if (path === '/stars.js') return serveFile(res, join(UI_DIR, 'stars.js'), 'application/javascript');
    if (path === '/galaxy.js') return serveFile(res, join(UI_DIR, 'galaxy.js'), 'application/javascript');
    if (path === '/favicon.ico' || path === '/favicon.svg') return serveFile(res, join(UI_DIR, 'favicon.svg'), 'image/svg+xml');

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  // === WebSocket (noServer — handled via upgrade) ===
  const acuiWss = new WebSocketServer({ noServer: true });
  const cloudWss = new WebSocketServer({ noServer: true });

  acuiWss.on('connection', ws => {
    wsClients.push(ws);
    ws.on('message', data => {
      const msg = parseJSON(data.toString());
      if (msg?.kind === 'acui:hello') {
        ws.send(JSON.stringify({ kind: 'acui:hello', v: 1 }));
      }
    });
    ws.on('close', () => { wsClients = wsClients.filter(c => c !== ws); });
  });

  cloudWss.on('connection', async (ws) => {
    let session = null;
    let configured = false;

    const { getConfig } = await import('./db.js');
    console.log('[ASR] 新 WebSocket 连接');

    ws.on('message', (raw) => {
      // FIX: ws@8.x with noServer:true receives ALL messages as Buffer
      // (including text frames like config/flush). Always try JSON.parse first.
      let msg = null;
      try { msg = JSON.parse(raw.toString()); } catch { msg = null; }

      if (msg && msg.type === 'config') {
        // ─── Handle config (first message or restart) ───
        if (configured && session) return; // ignore duplicate config while session active
        if (session) session.close(); // close old session if restarting
        const provider = msg.provider || 'aliyun';
        const apiKey = getConfig('asr_key') || process.env.DASHSCOPE_API_KEY || '';
        const doubaoAppId = getConfig('doubao_app_id') || '';
        const doubaoAccessToken = getConfig('doubao_access_token') || '';
        const doubaoResourceId = getConfig('doubao_resource_id') || 'volc.bigasr.sauc.duration';
        console.log('[ASR] 收到 config, provider:', provider, 'lang:', msg.lang);
        session = createCloudASRSession(
          {
            provider,
            lang: msg.lang || 'zh',
            aliyunApiKey: apiKey,
            doubaoAppId,
            doubaoAccessToken,
            doubaoResourceId,
          },
          (text, isFinal) => {
            try { ws.send(JSON.stringify({ type: 'transcript', text, is_final: isFinal })) } catch {}
          },
          (errMsg) => {
            console.log('[ASR] 错误:', errMsg);
            try { ws.send(JSON.stringify({ type: 'error', message: errMsg })) } catch {}
          },
          () => {
            console.log('[ASR] 云端连接关闭');
            // Don't close frontend WS — frontend can send new config to restart ASR
            try { ws.send(JSON.stringify({ type: 'session_ended' })) } catch {}
            session = null;
          }
        );
        configured = true;
        console.log('[ASR] 云端 ASR 会话已创建');
        return;
      }

      if (msg && msg.type === 'flush') {
        // ─── Flush: finish current ASR utterance ───
        session?.flush();
        console.log('[ASR] flush');
        return;
      }

      if (configured && raw instanceof Buffer && raw.length >= 32) {
        // ─── Binary audio data ───
        console.log('[ASR] 转发音频到云端, 大小:', raw.length, 'bytes');
        session?.sendAudio(raw);
      }
    });

    ws.on('close', () => { session?.close(); session = null });
    ws.on('error', () => { session?.close(); session = null });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/acui') {
      acuiWss.handleUpgrade(req, socket, head, (ws) => acuiWss.emit('connection', ws, req));
    } else if (url.pathname === '/voice/cloud') {
      cloudWss.handleUpgrade(req, socket, head, (ws) => cloudWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  return server;
}
