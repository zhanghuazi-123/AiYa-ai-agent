/**
 * 豆包 (火山引擎) 大模型流式语音识别 ASR 提供商
 * 
 * 协议: v3 (WebSocket 二进制协议)
 * 端点: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
 * 认证: WebSocket 升级头 X-Api-App-Key + X-Api-Access-Key + X-Api-Resource-Id
 * 
 * 二进制帧结构:
 *   4B Header + [4B Sequence if flags & 1] + 4B PayloadSize + Payload
 * 
 * Header:
 *   Byte 0: 0x11 = ProtocolVersion(1) + HeaderSize(1)
 *   Byte 1: MessageType(4bits) + Flags(4bits)
 *   Byte 2: Serialization(4bits) + Compression(4bits)  
 *   Byte 3: Reserved = 0x00
 * 
 * 消息类型:
 *   0x01 = FullClientRequest (配置), 0x02 = AudioOnly (音频),
 *   0x09 = FullServerResponse (结果), 0x0F = Error
 * 
 * Flags:
 *   0x00 = 无序列号, 0x01 = 有序列号(正), 
 *   0x02 = 最后一包(无序列号), 0x03 = 最后一包(有序列号)
 */

import { WebSocket } from 'ws';
import crypto from 'crypto';

const MAX_PENDING_CHUNKS = 16;

/**
 * 构建 v3 协议二进制帧
 * @param {number} msgType 消息类型 (1=config, 2=audio)
 * @param {number} flags 标志位 (0=无seq, 1=有seq, 2=最后一包)
 * @param {number} serialization 序列化方式 (0=none, 1=JSON)
 * @param {number} compression 压缩方式 (0=none, 1=gzip)
 * @param {Buffer} payload 负载数据
 * @returns {Buffer} 完整的二进制帧
 */
function buildV3Frame(msgType, flags, serialization, compression, payload) {
  const frame = Buffer.alloc(8 + payload.length);
  frame[0] = 0x11;  // version=1, header_size=4
  frame[1] = (msgType << 4) | flags;
  frame[2] = (serialization << 4) | compression;
  frame[3] = 0x00;  // reserved
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, 8);
  return frame;
}

/**
 * 解析 v3 协议二进制帧
 * @param {Buffer} buf 
 * @returns {{ type: number, flags: number, seq: number|null, payload: Buffer }|null}
 */
function parseV3Frame(buf) {
  if (buf.length < 8) return null;
  
  const version = (buf[0] >> 4) & 0x0f;
  const msgType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  
  let offset = 4;
  let seq = null;
  if (flags & 0x01) {
    seq = buf.readUInt32BE(offset);
    offset += 4;
  }
  
  const bodySize = buf.readUInt32BE(offset);
  offset += 4;
  
  if (bodySize > buf.length - offset) return null;
  
  return {
    type: msgType,
    flags,
    seq,
    payload: buf.subarray(offset, offset + bodySize),
    isLast: (flags & 0x02) !== 0,
  };
}

/**
 * 创建豆包 V3 ASR 会话
 * 
 * @param {object} config
 * @param {string} config.appId 火山引擎 APP ID
 * @param {string} config.accessToken 火山引擎 Access Token
 * @param {string} config.resourceId 资源 ID (volc.bigasr.sauc.duration)
 * @param {string} config.lang 语言 (zh/en 等)
 * @param {function} onTranscript(text, isFinal)
 * @param {function} onError(message)
 * @param {function} onClose()
 * @returns {{ sendAudio, flush, close }}
 */
export function createDoubaoSession(config, onTranscript, onError, onClose) {
  const {
    appId = '',
    accessToken = '',
    resourceId = 'volc.bigasr.sauc.duration',
    lang = 'zh',
  } = config;

  if (!appId || !accessToken) {
    onError('未配置豆包 APP ID 或 Access Token');
    return null;
  }

  const URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
  const connectId = crypto.randomUUID();
  
  let ready = false;
  let finished = false;
  const pending = [];
  let lastResultText = '';
  let lastSeq = 0;

  console.log('[Doubao ASR] 连接中...');

  const ws = new WebSocket(URL, {
    headers: {
      'X-Api-App-Key': appId,
      'X-Api-Access-Key': accessToken,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Connect-Id': connectId,
    },
    timeout: 10000,
    rejectUnauthorized: false,
  });

  ws.on('open', () => {
    console.log('[Doubao ASR] 连接成功');
    
    // 发送 Full Client Request
    const langCode = lang === 'zh' ? 'zh-CN' : (lang || 'zh-CN');
    const configMsg = {
      user: { uid: 'aiya-asr-' + Date.now() },
      audio: {
        format: 'pcm',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        result_type: 'full',
      },
    };

    const configBuf = Buffer.from(JSON.stringify(configMsg));
    ws.send(buildV3Frame(1, 0, 1, 0, configBuf)); // type=1, flags=0, json
    
    ready = true;
    // 发送积压的音频
    for (const buf of pending) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buf);
      }
    }
    pending.length = 0;
  });

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const frame = parseV3Frame(buf);
    
    if (!frame) return;
    
    if (frame.type === 0x09) {
      // Server Response - JSON payload
      const text = frame.payload.toString('utf8');
      
      try {
        const msg = JSON.parse(text);
        
        // 提取文本结果
        if (msg.result && msg.result.text) {
          const resultText = msg.result.text;
          if (resultText && resultText !== lastResultText) {
            // 判断是否是最终结果
            const isFinal = frame.isLast || (
              msg.result.utterances?.some(u => u.definite === true)
            );
            
            console.log('[Doubao ASR] 转录:', resultText, isFinal ? '(最终)' : '(临时)');
            lastResultText = resultText;
            onTranscript(resultText, Boolean(isFinal));
          }
        }
        
        // 处理分句 utterances
        if (msg.result && msg.result.utterances) {
          for (const utt of msg.result.utterances) {
            if (utt.definite && utt.text && utt.text !== lastResultText) {
              console.log('[Doubao ASR] 分句:', utt.text, '(definite)');
              lastResultText = utt.text;
            }
          }
        }

        // 检查是否是最后一帧
        if (frame.isLast) {
          finished = true;
          console.log('[Doubao ASR] 收到最终结果');
        }
      } catch (e) {
        console.warn('[Doubao ASR] JSON 解析失败:', e.message);
      }
    } else if (frame.type === 0x0F) {
      // Error
      if (frame.payload.length >= 8) {
        const code = frame.payload.readUInt32BE(0);
        const errLen = frame.payload.readUInt32BE(4);
        const errMsg = frame.payload.subarray(8, 8 + errLen).toString('utf8');
        console.error('[Doubao ASR] 错误:', code, errMsg);
        onError(`豆包 ASR 错误 (${code}): ${errMsg}`);
      } else {
        onError(`豆包 ASR 未知错误`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[Doubao ASR] 连接错误:', err.message);
    pending.length = 0;
    onError(err.message);
  });

  ws.on('close', () => {
    console.log('[Doubao ASR] 连接关闭');
    pending.length = 0;
    onClose();
  });

  return {
    /**
     * 发送音频数据 (16kHz, 16-bit, mono PCM)
     * @param {Buffer} pcmBuffer 
     */
    sendAudio(pcmBuffer) {
      if (finished) return;
      if (!ready) {
        if (pending.length < MAX_PENDING_CHUNKS) {
          pending.push(buildV3Frame(2, 0, 0, 0, pcmBuffer));
        }
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buildV3Frame(2, 0, 0, 0, pcmBuffer));
      }
    },

    /**
     * 发送结束标记，通知服务端音频结束
     */
    flush() {
      if (ws.readyState !== WebSocket.OPEN || finished) return;
      finished = true;
      // 发送最后一包标记 (type=2, flags=2=last, no seq)
      ws.send(buildV3Frame(2, 2, 0, 0, Buffer.alloc(0)));
    },

    /**
     * 关闭连接
     */
    close() {
      finished = true;
      try { ws.close(); } catch {}
    },
  };
}
