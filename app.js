const API = 'http://127.0.0.1:3722';
let currentAsrProvider = 'doubao'; // default provider, updated from server settings

// ─── settings panel ───
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const statusText = document.getElementById('statusText');
const memoryCount = document.getElementById('memoryCount');
const quotaInfo = document.getElementById('quotaInfo');

async function openSettings() {
  settingsOverlay.classList.add('open');
  settingsPanel.classList.add('open');
  updateSettings();
  loadContextSettings();
  loadVoiceSettings();
  loadToolsList();
}
function closeSettings() { settingsOverlay.classList.remove('open'); settingsPanel.classList.remove('open'); }
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

const apiKeyInput = document.getElementById('apiKeyInput');
document.getElementById('apiKeyToggle').addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

const tempRange = document.getElementById('tempRange');
const tempValue = document.getElementById('tempValue');
tempRange.addEventListener('input', () => { tempValue.textContent = tempRange.value; });

const providerModels = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat'],
  qwen: ['qwen3.6-flash', 'qwen3.6-plus', 'qwen-max'],
  minimax: ['MiniMax-M2.7', 'MiniMax-M1'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  custom: [],
};
const providerBaseUrls = {
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
  minimax: 'https://api.minimax.chat/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
};
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const baseUrlInput = document.getElementById('baseUrlInput');
providerSelect.addEventListener('change', () => {
  const p = providerSelect.value;
  modelSelect.innerHTML = providerModels[p].map(m => `<option>${m}</option>`).join('');
  baseUrlInput.value = providerBaseUrls[p];
  if (p === 'custom') baseUrlInput.placeholder = 'https://your-api.com/v1';
});

document.getElementById('activateBtn').addEventListener('click', async () => {
  const hint = document.getElementById('activateHint');
  hint.textContent = 'Activating...';
  try {
    const body = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value,
      model: modelSelect.value,
    };
    if (providerSelect.value === 'custom') {
      body.baseURL = baseUrlInput.value;
    }
    const res = await fetch(`${API}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      hint.textContent = `✅ 已激活: ${data.provider} / ${data.model}`;
      // Update saved state display
      if (apiKeyInput.value) apiKeyInput.placeholder = '***已配置***';
      apiKeyInput.value = '';
      providerSelect._saved = data.provider;
      modelSelect._saved = data.model;
    } else {
      hint.textContent = '❌ ' + (data.error || 'Unknown error');
    }
  } catch (e) { hint.textContent = 'Connection error'; }
});

async function updateSettings() {
  try {
    const [status, quota, voiceSettings] = await Promise.all([
      fetch(`${API}/status`).then(r => r.json()),
      fetch(`${API}/quota`).then(r => r.json()),
      fetch(`${API}/settings/voice`).then(r => r.json()).catch(() => null),
    ]);
    statusText.textContent = status.running ? 'Running' : 'Stopped';
    document.querySelector('.status-dot').className = `status-dot ${status.running ? 'running' : 'stopped'}`;
    memoryCount.textContent = status.memory_count ?? '—';
    quotaInfo.textContent = quota.rpmUsed || '—';
    // Update voice settings dropdowns
    if (voiceSettings?.asrProvider) {
      currentAsrProvider = voiceSettings.asrProvider;
      if (asrProv) asrProv.value = voiceSettings.asrProvider;
    }
  } catch {}
}

// ─── chat ───
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
let msgCount = 0, pendingBubble = null, streamBubble = null, lastTTSStreamEnd = '', streamEndMsgId = 0;

function escapeHtml(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

function addMessage(role, text, opts = {}) {
  msgCount++;
  const div = document.createElement('div'); div.className = `msg ${role}`;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  avatar.textContent = role === 'agent' ? 'A' : 'U';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  bubble.innerHTML = opts.thinking ? '<div class="thinking"><span></span><span></span><span></span></div>' : escapeHtml(text);
  div.appendChild(avatar); div.appendChild(bubble);
  if (role === 'agent' && !opts.thinking && text) {
    const btn = document.createElement('button'); btn.className = 'msg-speak-btn';
    btn.title = 'Read aloud'; btn.textContent = '🔊';
    btn.addEventListener('click', () => playTTSReply(text, btn)); div.appendChild(btn);
  }
  div._speakText = text || '';
  chatMessages.appendChild(div); chatMessages.scrollTop = chatMessages.scrollHeight;
  return { div, bubble };
}

async function sendMessage() {
  const text = chatInput.value.trim(); if (!text) return;
  chatInput.value = ''; messageSent = false; addMessage('user', text);
  pendingBubble = addMessage('agent', '', { thinking: true }).bubble;
  try {
    await fetch(`${API}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, from_id: 'WebUI', channel: 'web' }) });
  } catch { if (pendingBubble) { pendingBubble.querySelector('.thinking')?.remove(); pendingBubble.textContent = 'Connection failed.'; pendingBubble = null; } }
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

// ─── Voice input (continuous listening + cloud ASR + barge-in) ───
// Design: bailongma architecture — mic stays ON, ASR WS reconnects after TTS,
// barge-in via AnalyserNode volume monitoring + pre-buffer ring buffer.

const voiceBtn = document.getElementById('voiceBtn');
const ASR_WS_URL = 'ws://127.0.0.1:3722/voice/cloud';

const BARGEIN_WARMUP_MS     = 600;
const BARGEIN_FRAMES        = 8;
const BARGEIN_THRESHOLD     = 0.09;
const BARGEIN_PRE_BUFFER_MS = 1500;
const BARGEIN_MAX_CHUNKS    = 6;
const AUTO_SEND_DEBOUNCE_MS = 3000;

let micActive = false, micStream = null, audioCtx = null, processor = null, asrWs = null;
let autoSendTimer = null, lastAsrText = '', micGain = null, messageSent = false;
let lastSentText = '', lastSendTime = 0, voiceResumeTime = 0;
let analyserNode = null, dataArray = null, micSource = null;
let bargeinAnimFrame = null;
let suspendedByMedia = false, bargeinBuffering = false, bargeinBuffer = [];
let bargeinFrames = 0, ttsStartTime = 0;
let voiceState = 'idle';
let ttsAudioEl = null, ttsBtnEl = null;

// ─── Audio downsampling (阿里云 ASR 需要 16kHz PCM) ───
function downsampleTo16k(float32Array, inputSampleRate) {
  if (inputSampleRate === 16000) return float32Array;
  const ratio = inputSampleRate / 16000;
  const newLen = Math.round(float32Array.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, float32Array.length - 1);
    const frac = idx - lo;
    out[i] = float32Array[lo] + (float32Array[hi] - float32Array[lo]) * frac;
  }
  return out;
}

// ─── sphere pulse ───
const sunEl = document.getElementById('sun');
let sphereScale = 1.0, sphereGlow = 1.0;
const SUN_BASE = 280; // px, matches CSS

voiceBtn.addEventListener('click', async () => { micActive ? stopVoice() : await startVoice(); });

// ─── Processor setup (called on first WS connect and after reconnect/barge-in) ───
function setupASRProcessor() {
  if (processor) {
    try { processor.disconnect(micSource); } catch {}
  }
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  micSource.connect(processor);
  processor.connect(micGain);

  processor.onaudioprocess = (e) => {
    if (!asrWs || asrWs.readyState !== WebSocket.OPEN) return;
    // Downsample to 16kHz (Firefox may ignore AudioContext's sampleRate hint)
    let f32 = e.inputBuffer.getChannelData(0);
    const sr = audioCtx.sampleRate;
    if (sr !== 16000) f32 = downsampleTo16k(f32, sr);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    if (suspendedByMedia && bargeinBuffering) {
      bargeinBuffer.push(i16);
      if (bargeinBuffer.length > BARGEIN_MAX_CHUNKS) bargeinBuffer.shift();
      return;
    }
    asrWs.send(i16.buffer);
  };
}

// ─── Microphone + continuous volume monitoring ───
async function startVoice() {
  // IMPORTANT: Create AudioContext BEFORE any await — Firefox requires resume()
  // to be called within the user gesture handler context.
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  console.log('[Voice] AudioContext sampleRate:', audioCtx.sampleRate);
  try { await audioCtx.resume(); } catch (e) { console.warn('[Voice] AudioContext resume failed:', e); }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }
    });
  } catch (e) {
    console.error('[Voice] 麦克风被拒绝:', e.message);
    alert('Microphone denied');
    updateVoiceBtnState('error');
    setTimeout(() => updateVoiceBtnState('idle'), 2000);
    audioCtx.close(); audioCtx = null;
    return;
  }
  micActive = true;
  messageSent = false;
  updateVoiceBtnState('listening');
  chatInput.placeholder = '聆听中...';

  micSource = audioCtx.createMediaStreamSource(micStream);

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.5;
  dataArray = new Uint8Array(analyserNode.frequencyBinCount);
  micSource.connect(analyserNode);

  micGain = audioCtx.createGain();
  micGain.gain.value = 0;
  micGain.connect(audioCtx.destination);

  connectASR();
  startVolumeLoop();
}

// ─── Continuous volume detection loop (runs from mic start, handles barge-in) ───
function startVolumeLoop() {
  function drawFrame() {
    if (!micActive) return;
    if (!analyserNode) { bargeinAnimFrame = requestAnimationFrame(drawFrame); return; }

    analyserNode.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const vol = (sum / dataArray.length) / 255;

    // ─── Sphere pulse ───
    let targetScale, targetGlow;
    if (voiceState === 'speaking' && ttsAudioEl && !ttsAudioEl.paused) {
      // TTS playback: breathe from audio progress
      const dur = ttsAudioEl.duration || 5;
      const t = ttsAudioEl.currentTime;
      // Two-breath rhythm — mimics natural speech cadence
      const breath = Math.sin(t / dur * Math.PI * 6) * 0.5 + Math.sin(t / dur * Math.PI * 10) * 0.3;
      targetScale = 1.0 + (breath + 1) * 0.5 * 0.22;
      targetGlow = 1.0 + (breath + 1) * 0.5 * 3.0;
    } else {
      // Mic volume driven
      targetScale = 1.0 + vol * 0.35;
      targetGlow = 1.0 + vol * 2.5;
    }
    sphereScale += (targetScale - sphereScale) * 0.35;
    sphereGlow += (targetGlow - sphereGlow) * 0.3;

    // Sun rendering
    if (sunEl) {
      const s = sphereScale;
      const g = sphereGlow;

      // State-based colors
      const colors = {
        listening:   { c1: '200,220,255', c2: '110,198,255', c3: '196,77,255', a1: 0.55, a2: 0.35, a3: 0.22, g1: 0.4,  g2: 0.25, g3: 0.15 },
        recognizing: { c1: '180,220,255', c2: '80,160,255',  c3: '130,130,245', a1: 0.65, a2: 0.45, a3: 0.3,  g1: 0.55, g2: 0.35, g3: 0.2  },
        speaking:    { c1: '255,200,240', c2: '196,77,255',  c3: '255,107,157', a1: 0.5,  a2: 0.28, a3: 0.18, g1: 0.4,  g2: 0.22, g3: 0.12 },
        idle:        { c1: '255,255,255', c2: '196,77,255',  c3: '255,107,157', a1: 0.45, a2: 0.28, a3: 0.18, g1: 0.3,  g2: 0.18, g3: 0.12 },
      };
      const c = colors[voiceState] || colors.idle;

      const scale = SUN_BASE * s;
      sunEl.style.width = scale + 'px';
      sunEl.style.height = scale + 'px';

      const innerR = Math.round(60 * g), midR = Math.round(120 * g), outerR = Math.round(220 * g);
      sunEl.style.background = `radial-gradient(circle at 35% 35%,
        rgba(${c.c1},${c.a1 * g}) 0%, rgba(${c.c2},${c.a2 * g}) 15%,
        rgba(${c.c3},${c.a3 * g}) 50%, transparent 70%)`;
      sunEl.style.boxShadow = `0 0 ${innerR}px rgba(${c.c1},${c.g1 * g}), 0 0 ${midR}px rgba(${c.c2},${c.g2 * g}), 0 0 ${outerR}px rgba(${c.c3},${c.g3 * g})`;
    }

    // ─── Barge-in detection ───
    if (suspendedByMedia) {
      const aecReady = Date.now() - ttsStartTime > BARGEIN_WARMUP_MS;
      if (aecReady && vol > BARGEIN_THRESHOLD) {
        if (++bargeinFrames >= BARGEIN_FRAMES) {
          bargeinFrames = 0;
          triggerBargein();
        }
      } else {
        bargeinFrames = 0;
      }
    }

    bargeinAnimFrame = requestAnimationFrame(drawFrame);
  }
  bargeinAnimFrame = requestAnimationFrame(drawFrame);
}

function triggerBargein() {
  window.stopTTS();
  const savedBuffer = bargeinBuffer.slice();
  bargeinBuffer = [];
  bargeinBuffering = false;
  suspendedByMedia = false;

  // Reconnect ASR and replay pre-buffered audio
  asrWs = new WebSocket(ASR_WS_URL);
  asrWs.binaryType = 'arraybuffer';
  asrWs.onopen = () => {
    asrWs.send(JSON.stringify({ type: 'config', provider: currentAsrProvider, lang: 'zh' }));
    setupASRProcessor();
    for (const chunk of savedBuffer) {
      try { asrWs.send(chunk.buffer); } catch {}
    }
    updateVoiceBtnState('recognizing');
  };
  asrWs.onmessage = handleASRMessage;
  asrWs.onerror = () => { if (micActive) stopVoice(); };
  asrWs.onclose = () => { if (micActive && !suspendedByMedia) reconnectASR(); };
}

// ─── TTS playback ───
window.stopTTS = () => {
  if (!ttsAudioEl) return;
  ttsAudioEl.pause();
  try { URL.revokeObjectURL(ttsAudioEl.src); } catch {}
  ttsAudioEl = null;
  if (ttsBtnEl) { ttsBtnEl.classList.remove('playing'); ttsBtnEl = null; }
};

async function playTTSReply(text, btn) {
  if (!text) return;
  try {
    window.stopTTS();
    if (btn) {
      document.querySelectorAll('.msg-speak-btn.playing').forEach(b => b.classList.remove('playing'));
      btn.classList.add('playing');
      ttsBtnEl = btn;
    }

    const resp = await fetch('http://127.0.0.1:3722/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    ttsAudioEl = new Audio(url);

    // Suspend ASR, keep mic open for barge-in
    suspendedByMedia = true;
    ttsStartTime = Date.now();
    bargeinBuffering = true;
    bargeinBuffer = [];
    bargeinFrames = 0;
    updateVoiceBtnState('speaking');

    // Close current ASR WS but keep mic/processor alive
    if (asrWs) { try { asrWs.send(JSON.stringify({ type: 'flush' })); asrWs.close(); } catch {} asrWs = null; }

    await ttsAudioEl.play();

    ttsAudioEl.onended = () => { if (btn) btn.classList.remove('playing'); ttsAudioEl = null; ttsBtnEl = null; URL.revokeObjectURL(url); resumeAfterTTS(); };
    ttsAudioEl.onerror = () => { if (btn) btn.classList.remove('playing'); ttsAudioEl = null; ttsBtnEl = null; URL.revokeObjectURL(url); resumeAfterTTS(); };
  } catch (e) {
    console.error('[TTS] 播放失败:', e.message);
    if (btn) btn.classList.remove('playing');
    ttsAudioEl = null; ttsBtnEl = null;
    resumeAfterTTS();
  }
}

function resumeAfterTTS() {
  suspendedByMedia = false;
  bargeinBuffering = false;
  bargeinBuffer = [];
  bargeinFrames = 0;
  messageSent = false;
  voiceResumeTime = Date.now(); // ★ 记录恢复时间用于回声抑制
  if (micActive) {
    connectASR();
    updateVoiceBtnState('listening');
  } else {
    updateVoiceBtnState('idle');
  }
}

function handleASRMessage(ev) {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'transcript') {
      const text = (msg.text || '').trim(); if (!text) return;
      // ★ 去重: 如果和上次已发送的文本相同，忽略
      if (text === lastSentText) return;
      // ★ 回声抑制: TTS 结束后 2 秒内忽略 ASR 结果(防止TTS回声循环)
      if (voiceResumeTime && Date.now() - voiceResumeTime < 2000) return;
      // ★ 限流: 5秒内不重复发送
      const now = Date.now();
      if (now - lastSendTime < 5000) return;
      lastAsrText = text; chatInput.value = text;
      if (msg.is_final) {
        clearTimeout(autoSendTimer);
        if (messageSent) { messageSent = false; return; }
        updateVoiceBtnState('processing');
        chatInput.value = text;
        lastSentText = text;
        lastSendTime = Date.now();
        chatSend.click();
        lastAsrText = '';
      } else {
        updateVoiceBtnState('recognizing');
        clearTimeout(autoSendTimer);
        autoSendTimer = setTimeout(() => {
          if (lastAsrText.trim() && !messageSent) {
            // ★ 去重 + 限流
            if (lastAsrText.trim() === lastSentText) return;
            if (Date.now() - lastSendTime < 5000) return;
            messageSent = true;
            chatInput.value = lastAsrText.trim();
            lastSentText = lastAsrText.trim();
            lastSendTime = Date.now();
            chatSend.click();
            lastAsrText = '';
            // ★ 发送后 flush ASR 会话，避免 session 空转重启循环
            if (asrWs && asrWs.readyState === WebSocket.OPEN) {
              try { asrWs.send(JSON.stringify({ type: 'flush' })); } catch {}
            }
          }
        }, AUTO_SEND_DEBOUNCE_MS);
      }
    } else if (msg.type === 'error') {
      console.error('[ASR] 错误:', msg.message);
      updateVoiceBtnState('error');
      const statusEl = document.getElementById('voiceStatus');
      if (statusEl) statusEl.textContent = 'ASR错误: ' + (msg.message || '');
      setTimeout(() => { if (micActive) updateVoiceBtnState('listening'); }, 3000);
    } else if (msg.type === 'session_ended') {
      console.log('[ASR] ASR会话结束，准备重启');
      // ASR session ended — send new config to restart if mic still active
      if (micActive && asrWs && asrWs.readyState === WebSocket.OPEN) {
        asrWs.send(JSON.stringify({ type: 'config', provider: currentAsrProvider, lang: 'zh' }));
      }
    }
  } catch (e) { console.error('[ASR] handleASRMessage error:', e); }
}

function connectASR() {
  asrWs = new WebSocket(ASR_WS_URL);
  asrWs.binaryType = 'arraybuffer';
  asrWs.onopen = () => {
    asrWs.send(JSON.stringify({ type: 'config', provider: currentAsrProvider, lang: 'zh' }));
    setupASRProcessor();
  };
  asrWs.onmessage = handleASRMessage;
  asrWs.onerror = () => {};
  asrWs.onclose = () => { if (micActive && !suspendedByMedia) reconnectASR(); };
}

function reconnectASR() {
  setTimeout(() => { if (micActive) connectASR(); }, 200);
}

function stopVoice() {
  micActive = false;
  messageSent = false;
  lastSentText = ''; // ★ 重置发送记录，新会话可以重新发送
  lastSendTime = 0;
  voiceResumeTime = 0;
  updateVoiceBtnState('idle');
  chatInput.placeholder = 'Message AiYa...';
  clearTimeout(autoSendTimer);
  cancelAnimationFrame(bargeinAnimFrame);
  suspendedByMedia = false;
  bargeinBuffering = false;
  bargeinBuffer.length = 0;
  bargeinFrames = 0;
  if (asrWs) { try { asrWs.send(JSON.stringify({ type: 'flush' })); } catch {} setTimeout(() => { try { asrWs?.close(); } catch {} }, 200); asrWs = null; }
  try { processor?.disconnect(); } catch {}; processor = null;
  try { micSource?.disconnect(); } catch {}; micSource = null;
  try { micGain?.disconnect(); } catch {}; micGain = null;
  try { analyserNode?.disconnect(); } catch {}; analyserNode = null;
  try { audioCtx?.close(); } catch {}; audioCtx = null;
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  // Reset sun to CSS default
  if (sunEl) {
    sunEl.style.width = '';
    sunEl.style.height = '';
    sunEl.style.background = '';
    sunEl.style.boxShadow = '';
  }
  sphereScale = 1.0;
  sphereGlow = 1.0;
}

function updateVoiceBtnState(state) {
  voiceState = state;
  voiceBtn.className = 'voice-btn' + (state !== 'idle' ? ` ${state}` : '');
  const statusEl = document.getElementById('voiceStatus');
  if (statusEl) {
    const labels = { idle: '', listening: '聆听中', recognizing: '识别中', speaking: '说话中', processing: '处理中', error: '错误' };
    statusEl.textContent = labels[state] || '';
  }
  // Sun label: show during processing
  const sunLabel = document.getElementById('sunLabel');
  if (sunLabel) {
    if (state === 'processing') {
      sunLabel.textContent = 'AiYa thinking...';
      sunLabel.classList.add('visible');
    } else {
      sunLabel.classList.remove('visible');
    }
  }
}

// ─── SSE ───
function connectSSE() {
  const es = new EventSource(`${API}/events`);
  es.addEventListener('stream_chunk', e => {
    const d = JSON.parse(e.data); if (d.mode === 'think') return;
    if (!streamBubble) {
      if (pendingBubble) { pendingBubble.querySelector('.thinking')?.remove(); streamBubble = pendingBubble; pendingBubble = null; streamBubble.textContent = ''; }
      else { streamBubble = addMessage('agent', '').bubble; }
    }
    streamBubble.textContent += d.text || '';
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
  es.addEventListener('stream_end', () => {
    if (streamBubble && streamEndMsgId !== msgCount) {
      streamEndMsgId = msgCount;
      const msgEl = streamBubble.closest('.msg');
      const text = streamBubble.textContent.trim();
      if (msgEl && text && text !== lastTTSStreamEnd) {
        lastTTSStreamEnd = text;
        msgEl._speakText = text;
        if (!msgEl.querySelector('.msg-speak-btn')) {
          const btn = document.createElement('button'); btn.className = 'msg-speak-btn'; btn.title = 'Read aloud'; btn.textContent = '🔊';
          btn.addEventListener('click', () => playTTSReply(text, btn)); msgEl.appendChild(btn);
        }
        playTTSReply(text, msgEl.querySelector('.msg-speak-btn')); // auto-play
      }
    }
    streamBubble = null; pendingBubble = null; updateSettings();
  });
  es.addEventListener('response', e => {
    const d = JSON.parse(e.data);
    if (!streamBubble && pendingBubble) { pendingBubble.querySelector('.thinking')?.remove(); pendingBubble.textContent = d.content || ''; }
    streamBubble = null; pendingBubble = null;
    if (d.content) {
      const lastMsg = chatMessages.querySelector('.msg.agent:last-child');
      if (lastMsg) lastMsg._speakText = d.content;
    }
    updateSettings();
  });
  es.addEventListener('error', e => { console.error('[SSE] EventSource error:', e); });
  es.onerror = () => {};
}
connectSSE();


// ─── voice settings ───
const asrProv = document.getElementById('asrProvider'), ttsProv = document.getElementById('ttsProvider');

// Toggle provider-specific credential visibility
function toggleVoiceCreds() {
  const asr = asrProv?.value;
  const tts = ttsProv?.value;
  document.querySelectorAll('.asr-doubao-creds').forEach(el => el.style.display = asr === 'doubao' ? '' : 'none');
  document.querySelectorAll('.tts-doubao-creds').forEach(el => el.style.display = tts === 'doubao' ? '' : 'none');
  document.querySelectorAll('.tts-openai-creds').forEach(el => el.style.display = tts === 'openai' ? '' : 'none');
  document.querySelectorAll('.tts-minimax-creds').forEach(el => el.style.display = tts === 'minimax' ? '' : 'none');
}

// Load voice settings from server and populate UI
async function loadVoiceSettings() {
  try {
    const vs = await fetch(`${API}/settings/voice`).then(r => r.json());
    if (vs.asrProvider && asrProv) asrProv.value = vs.asrProvider;
    if (vs.ttsProvider && ttsProv) ttsProv.value = vs.ttsProvider;
    // Doubao ASR fields
    const dAppId = document.getElementById('doubaoAppId');
    const dToken = document.getElementById('doubaoAccessToken');
    const dResId = document.getElementById('doubaoResourceId');
    if (dAppId) dAppId.placeholder = vs.doubaoAppId || '4144325380';
    if (dToken) dToken.placeholder = vs.doubaoAccessToken || 'x7G5...';
    if (dResId) dResId.placeholder = vs.doubaoResourceId || 'volc.bigasr.sauc.duration';
    // TTS fields
    const ttsKeyEl = document.getElementById('ttsKeyInput');
    if (ttsKeyEl) ttsKeyEl.placeholder = vs.ttsKey || 'TTS API Key';
    const ttsDAppId = document.getElementById('ttsDoubaoAppId');
    if (ttsDAppId) ttsDAppId.placeholder = vs.ttsDoubaoAppId || 'App ID (可选)';
    const ttsDAccessKey = document.getElementById('ttsDoubaoAccessKey');
    if (ttsDAccessKey) ttsDAccessKey.placeholder = vs.ttsDoubaoAccessKey || 'Access Key (可选)';
    const ttsDResId = document.getElementById('ttsDoubaoResourceId');
    if (ttsDResId) ttsDResId.placeholder = vs.ttsDoubaoResourceId || 'Resource ID (可选)';
    const ttsOaiKey = document.getElementById('ttsOpenaiKey');
    if (ttsOaiKey) ttsOaiKey.placeholder = vs.ttsOpenaiKey || 'sk-...';
    const ttsOaiBase = document.getElementById('ttsOpenaiBaseUrl');
    if (ttsOaiBase) ttsOaiBase.placeholder = vs.ttsOpenaiBaseUrl || 'https://api.openai.com';
    const ttsMmxKey = document.getElementById('ttsMinimaxKey');
    if (ttsMmxKey) ttsMmxKey.placeholder = vs.ttsMinimaxKey || '留空则使用 LLM Key';
    // Voice select
    const voiceEl = document.getElementById('ttsVoice');
    if (voiceEl && vs.ttsVoice) voiceEl.value = vs.ttsVoice;
    // Update current ASR provider for voice input
    if (vs.asrProvider) currentAsrProvider = vs.asrProvider;
    // Show/hide provider-specific fields
    toggleVoiceCreds();
  } catch (e) { console.warn('[Settings] 加载语音设置失败:', e); }
}

// Save all voice settings to server
async function saveVoiceSettings() {
  const hint = document.getElementById('voiceHint');
  if (!hint) return;
  hint.textContent = 'Saving...';
  try {
    const body = {
      asrProvider: asrProv?.value,
      ttsProvider: ttsProv?.value,
      ttsVoice: document.getElementById('ttsVoice')?.value,
    };
    // Doubao ASR fields (only send if non-empty)
    const dAppId = document.getElementById('doubaoAppId')?.value;
    const dToken = document.getElementById('doubaoAccessToken')?.value;
    const dResId = document.getElementById('doubaoResourceId')?.value;
    if (dAppId) body.doubaoAppId = dAppId;
    if (dToken) body.doubaoAccessToken = dToken;
    if (dResId) body.doubaoResourceId = dResId;
    // TTS fields (only send if non-empty)
    const ttsKey = document.getElementById('ttsKeyInput')?.value;
    const ttsDAppId = document.getElementById('ttsDoubaoAppId')?.value;
    const ttsDAccessKey = document.getElementById('ttsDoubaoAccessKey')?.value;
    const ttsDResId = document.getElementById('ttsDoubaoResourceId')?.value;
    const ttsOaiKey = document.getElementById('ttsOpenaiKey')?.value;
    const ttsOaiBase = document.getElementById('ttsOpenaiBaseUrl')?.value;
    const ttsMmxKey = document.getElementById('ttsMinimaxKey')?.value;
    if (ttsKey) body.ttsKey = ttsKey;
    if (ttsDAppId) body.ttsDoubaoAppId = ttsDAppId;
    if (ttsDAccessKey) body.ttsDoubaoAccessKey = ttsDAccessKey;
    if (ttsDResId) body.ttsDoubaoResourceId = ttsDResId;
    if (ttsOaiKey) body.ttsOpenaiKey = ttsOaiKey;
    if (ttsOaiBase) body.ttsOpenaiBaseUrl = ttsOaiBase;
    if (ttsMmxKey) body.ttsMinimaxKey = ttsMmxKey;

    await fetch(`${API}/settings/voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (asrProv) currentAsrProvider = asrProv.value;
    // Reload to update placeholder statuses
    await loadVoiceSettings();
    hint.textContent = '✅ 已保存!';
    setTimeout(() => { hint.textContent = ''; }, 3000);
  } catch (e) {
    hint.textContent = '❌ 保存失败: ' + e.message;
    setTimeout(() => { hint.textContent = ''; }, 3000);
  }
}

// Wire up provider dropdown change → show/hide fields
asrProv?.addEventListener('change', () => { toggleVoiceCreds(); });
ttsProv?.addEventListener('change', () => { toggleVoiceCreds(); });

// Save button
document.getElementById('saveVoiceBtn')?.addEventListener('click', saveVoiceSettings);

// ─── context settings ───
const weatherToggle = document.getElementById('weatherToggle');
const hotspotsToggle = document.getElementById('hotspotsToggle');
const hotspotPlatform = document.getElementById('hotspotPlatform');
const cityInput = document.getElementById('cityInput');
const tickIntervalRange = document.getElementById('tickIntervalRange');
const tickIntervalValue = document.getElementById('tickIntervalValue');
const saveContextBtn = document.getElementById('saveContextBtn');
const contextHint = document.getElementById('contextHint');

tickIntervalRange?.addEventListener('input', () => {
  if (tickIntervalValue) tickIntervalValue.textContent = tickIntervalRange.value;
});

saveContextBtn?.addEventListener('click', async () => {
  if (!contextHint) return;
  contextHint.textContent = 'Saving...';
  try {
    await Promise.all([
      fetch(`${API}/settings/context`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weatherEnabled: weatherToggle?.checked,
          hotspotsEnabled: hotspotsToggle?.checked,
          hotspotPlatform: hotspotPlatform?.value,
          city: cityInput?.value,
        }),
      }),
      fetch(`${API}/settings/tick`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: tickIntervalRange?.value }),
      }),
    ]);
    contextHint.textContent = 'Saved!';
    setTimeout(() => { if (contextHint) contextHint.textContent = ''; }, 2000);
  } catch (e) { contextHint.textContent = 'Save failed'; }
});

async function loadContextSettings() {
  try {
    const [ctx, tick] = await Promise.all([
      fetch(`${API}/settings/context`).then(r => r.json()),
      fetch(`${API}/settings/tick`).then(r => r.json()),
    ]);
    if (weatherToggle) weatherToggle.checked = ctx.weatherEnabled;
    if (hotspotsToggle) hotspotsToggle.checked = ctx.hotspotsEnabled;
    if (hotspotPlatform) hotspotPlatform.value = ctx.hotspotPlatform || 'weibo';
    if (cityInput) cityInput.value = ctx.city || 'Beijing';
    if (tickIntervalRange) tickIntervalRange.value = tick.intervalMinutes || 20;
    if (tickIntervalValue) tickIntervalValue.textContent = tick.intervalMinutes || 20;
  } catch {}
}

// ─── tools list ───
async function loadToolsList() {
  const el = document.getElementById('toolsList');
  if (!el) return;
  try {
    const data = await fetch(`${API}/tools`).then(r => r.json());
    if (data.tools) {
      el.innerHTML = data.tools.map(t =>
        `<div class="tool-item"><span class="tool-name">${t.name}</span><span class="tool-desc">${t.description}</span></div>`
      ).join('');
    }
  } catch { el.textContent = 'Failed to load tools'; }
}

setInterval(updateSettings, 15000);
