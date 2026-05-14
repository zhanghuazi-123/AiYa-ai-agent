import { getConfig, setConfig } from './db.js';

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat'],
  },
  qwen: {
    label: 'Qwen (通义千问)',
    baseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    envKey: 'QWEN_API_KEY',
    defaultModel: 'qwen3.6-flash',
    models: ['qwen3.6-flash', 'qwen3.6-plus', 'qwen-max'],
  },
  minimax: {
    label: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    envKey: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M1'],
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
  custom: {
    label: 'Custom Endpoint',
    baseURL: '',
    envKey: null,
    defaultModel: '',
    models: [],
  },
};

export const config = {
  provider: null,
  model: null,
  apiKey: null,
  baseURL: null,
  needsActivation: true,
  temperature: 0.5,
};

export function loadConfig() {
  const stored = getConfig('llm_provider');
  if (stored) {
    config.provider = stored;
    config.model = getConfig('llm_model') || PROVIDERS[stored]?.defaultModel;
    config.apiKey = getConfig('llm_api_key');
    config.baseURL = stored === 'custom' ? getConfig('llm_base_url') : PROVIDERS[stored]?.baseURL;
    config.needsActivation = false;
    return true;
  }

  // Check .env in priority order
  for (const [key, p] of Object.entries(PROVIDERS)) {
    if (!p.envKey) continue;
    const envVal = process.env[p.envKey];
    if (envVal) {
      config.provider = key;
      config.apiKey = envVal;
      config.model = process.env[p.envKey.replace('_API_KEY', '_MODEL')] || p.defaultModel;
      config.baseURL = p.baseURL;
      config.needsActivation = false;
      return true;
    }
  }

  return false;
}

export async function activate(provider, apiKey, model, baseURL) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);

  const useBaseURL = provider === 'custom' ? baseURL : p.baseURL;
  if (!useBaseURL) throw new Error('Base URL required for custom provider');

  // Validate key with a test call
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: useBaseURL, timeout: 15000, maxRetries: 0 });
  await client.chat.completions.create({
    model: model || p.defaultModel,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 5,
    temperature: 0,
  });

  // Save to config
  config.provider = provider;
  config.model = model || p.defaultModel;
  config.apiKey = apiKey;
  config.baseURL = useBaseURL;
  config.needsActivation = false;

  setConfig('llm_provider', provider);
  setConfig('llm_model', config.model);
  setConfig('llm_api_key', apiKey);
  if (provider === 'custom') setConfig('llm_base_url', useBaseURL);

  return { provider, model: config.model };
}

// ─── TTS credentials ───
export function getTTSCredentials() {
  return {
    provider: getConfig('tts_provider') || 'doubao',
    voiceId: getConfig('tts_voice') || 'zh_female_xiaohe_uranus_bigtts',
    doubaoKey: getConfig('tts_doubao_key') || '',
    doubaoAppId: getConfig('tts_doubao_app_id') || '',
    doubaoAccessKey: getConfig('tts_doubao_access_key') || '',
    doubaoResourceId: getConfig('tts_doubao_resource_id') || '',
    minimaxKey: getConfig('tts_minimax_key') || config.apiKey && config.provider === 'minimax' ? config.apiKey : '',
    openaiKey: getConfig('tts_openai_key') || '',
    openaiBaseURL: getConfig('tts_openai_base_url') || 'https://api.openai.com',
    elevenLabsKey: getConfig('tts_elevenlabs_key') || '',
    volcanoAppId: getConfig('tts_volcano_app_id') || '',
    volcanoToken: getConfig('tts_volcano_token') || '',
  };
}
