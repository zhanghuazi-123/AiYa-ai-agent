import OpenAI from 'openai';
import { config } from './config.js';
import { recordUsage, shouldThrottle } from './quota.js';

let client = null;
let clientSig = '';

function getClient() {
  const sig = `${config.provider}|${config.baseURL}|${config.apiKey}`;
  if (client && clientSig === sig) return client;
  if (!config.apiKey) throw new Error('LLM not activated');
  client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  clientSig = sig;
  return client;
}

// === Streaming ===

export async function* streamLLM({ messages, tools = [], temperature, maxTokens, thinking = true, signal }) {
  const params = {
    model: config.model,
    temperature: temperature ?? config.temperature,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (config.provider === 'deepseek') {
    if (thinking) params.reasoning_effort = 'high';
    params.thinking = { type: thinking ? 'enabled' : 'disabled' };
  }
  // qwen/minimax/openai: no special thinking params

  if (maxTokens) params.max_tokens = maxTokens;
  else params.max_tokens = 4096; // Ensure enough room for reasoning + response
  if (tools.length > 0) {
    params.tools = tools;
    params.tool_choice = 'auto';
  }

  const stream = await getClient().chat.completions.create(params, { signal });

  let content = '';
  let reasoningContent = '';
  let toolCalls = new Map();
  let usageTokens = 0;

  for await (const chunk of stream) {
    if (signal?.aborted) break;
    if (chunk.usage?.total_tokens) usageTokens = chunk.usage.total_tokens;

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls.has(idx)) toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
        const t = toolCalls.get(idx);
        if (tc.id) t.id = tc.id;
        if (tc.function?.name) t.name += tc.function.name;
        if (tc.function?.arguments) t.arguments += tc.function.arguments;
      }
      continue;
    }

    if (delta.reasoning_content || delta.reasoning) {
      const rc = delta.reasoning_content || delta.reasoning || '';
      reasoningContent += rc;
      yield { type: 'chunk', content: rc, reasoning: true };
    }
    if (delta.content) {
      content += delta.content;
      yield { type: 'chunk', content: delta.content, reasoning: false };
    }
  }

  if (usageTokens > 0) recordUsage(usageTokens);
  // Yield final tool calls after stream ends
  if (toolCalls.size > 0) {
    yield { type: 'tool_calls', calls: [...toolCalls.values()].filter(t => t.name) };
  }

  return { content, reasoningContent };
}

// === Agentic Tool Loop ===

const MAX_ROUNDS = 8;
const MAX_TOTAL_CALLS = 14;
const MAX_CONSECUTIVE_FAILURES = 3;

export async function callLLM({ systemPrompt, message, tools = [], temperature, thinking = true, signal, onToolCall, onStream }) {
  const toolSchemas = tools.map(t => typeof t === 'string' ? { type: 'function', function: { name: t, parameters: {} } } : t);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  if (shouldThrottle()) {
    return { content: '(Quota near limit, waiting for window reset)', toolResult: null };
  }

  let allContent = '';
  let lastToolResult = null;
  let totalCalls = 0;
  let consecutiveFailures = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) break;

    const gen = streamLLM({ messages, tools: toolSchemas, temperature, thinking, signal });
    let content = '';
    let reasoningContent = '';
    let toolCalls = [];

    for await (const event of gen) {
      if (signal?.aborted) break;
      if (event.type === 'chunk') {
        if (event.reasoning) reasoningContent += event.content;
        else content += event.content;
        onStream?.({ mode: event.reasoning ? 'think' : 'text', text: event.content });
      } else if (event.type === 'tool_calls') {
        toolCalls = event.calls;
      }
    }

    if (signal?.aborted) break;
    allContent += (allContent ? '\n' : '') + content;

    if (toolCalls.length === 0) break;

    // Execute tools
    const toolResults = [];
    for (const tc of toolCalls) {
      totalCalls++;
      if (totalCalls > MAX_TOTAL_CALLS) {
        toolResults.push({ id: tc.id, name: tc.name, result: 'Tool call budget exceeded' });
        continue;
      }

      let args = {};
      try { args = JSON.parse(tc.arguments || '{}'); } catch {}

      onToolCall?.({ name: tc.name, args });
      const result = await executeTool(tc.name, args, signal);
      toolResults.push({ id: tc.id, name: tc.name, args, result });

      if (isToolFailure(result)) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      } else {
        consecutiveFailures = 0;
      }

      lastToolResult = { name: tc.name, args, result };
    }

    // Add assistant + tool messages to conversation
    messages.push({
      role: 'assistant',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' },
      })),
      content: content || undefined,
    });
    if (reasoningContent) messages[messages.length - 1].reasoning_content = reasoningContent;

    for (const tr of toolResults) {
      messages.push({ role: 'tool', tool_call_id: tr.id, content: String(tr.result) });
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      messages.push({ role: 'user', content: 'Too many consecutive tool failures. Stop retrying and explain the situation to the user.' });
      // One more round for explanation
      continue;
    }

    // If send_message was called, add a nudge
    const hadSendMessage = toolResults.some(t => t.name === 'send_message');
    if (!hadSendMessage) {
      messages.push({ role: 'user', content: 'Continue completing the task. If enough information is available, call send_message to reply to the user.' });
    }
  }

  return { content: allContent, toolResult: lastToolResult };
}

// === Tool execution (imported dynamically to avoid circular deps) ===
import { executeTool, isToolFailure } from './capabilities/executor.js';
