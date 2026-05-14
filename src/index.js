import { initSchema, getMemoryCount, insertConversation, getConfig, setConfig, getDueReminders, fireReminder, getDB } from './db.js';
import { loadConfig, config, activate } from './config.js';
import { callLLM } from './llm.js';
import { runInjector } from './memory/injector.js';
import { buildSystemPrompt } from './prompt.js';
import { runRecognizer } from './memory/recognizer.js';
import { extractKeywords, formatTick, formatEntityTimeDesc } from './memory/utils.js';
import { getToolSchemas, ALL_TOOLS } from './capabilities/schemas.js';
import { getQuotaStatus, shouldThrottle, setRateLimited } from './quota.js';
import { createAPI, emitSSE } from './api.js';
import { getTickIntervalMs } from './runtime/ticker.js';
import { gatherContext, formatExtraContext } from './context/gatherer.js';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// === State ===
const state = {
  running: false,
  agentName: 'AiYa',
  memoryCount: 0,
  tickTimer: null,
  messageQueue: [],
  processing: false,
  abortController: null,
  backgroundProcesses: new Map(), // pid -> { cmd, child }
};

// === Initialization ===
function init() {
  initSchema();

  // Seed sandbox
  const sandbox = join(process.cwd(), 'sandbox');
  if (!existsSync(sandbox)) mkdirSync(sandbox, { recursive: true });
  const readme = join(sandbox, 'readme.txt');
  if (!existsSync(readme)) writeFileSync(readme, 'AiYa Sandbox\n============\nThis is a workspace for your agent.\n', 'utf-8');

  // Seed memories if empty
  if (getMemoryCount() === 0) {
    seedMemories();
  }

  // Load config
  const activated = loadConfig();

  // Recover task
  const task = getConfig('current_task');
  if (task) console.log(`[System] Recovered task: ${task}`);

  // Set birth time
  if (!getConfig('birth_time')) setConfig('birth_time', new Date().toISOString());

  state.memoryCount = getMemoryCount();

  return activated;
}

function seedMemories() {
  const seedData = [
    { type: 'knowledge', content: 'You are AiYa (爱娅), a continuously running AI agent with persistent memory. You can execute tools, search the web, manage files, and maintain a knowledge graph of everything you learn.', title: 'Agent Identity', memId: 'agent_identity', tags: ['system'] },
    { type: 'knowledge', content: 'Your core loop: TICK (autonomous heartbeat) → message/reminder processing → LLM thinking + tool execution → memory recognition. When idle, TICK arrives every 20 minutes.', title: 'Core Architecture', memId: 'core_architecture', tags: ['system'] },
    { type: 'knowledge', content: 'You MUST reply to user messages with send_message as your first tool call. Never describe actions in text — actually invoke tools via function calling.', title: 'Tool Usage Rules', memId: 'tool_rules', tags: ['system', 'rule'] },
    { type: 'fact', content: `The current user is named "YuanDa" (ID:000001).`, memId: 'person_000001_preference', entities: ['ID:000001'], tags: ['person'] },
    { type: 'fact', content: 'YuanDa is a developer who created this project. He speaks Chinese and English.', memId: 'fact_yuanda_dev', entities: ['ID:000001'], tags: ['person'] },
  ];

  const { insertMemory } = getDB();
  const stmt = getDB().prepare(`
    INSERT INTO memories (type, content, detail, title, mem_id, entities, concepts, tags, links, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const s of seedData) {
    stmt.run(s.type, s.content, s.detail || '', s.title || '', s.memId || null,
      JSON.stringify(s.entities || []), JSON.stringify(s.concepts || []),
      JSON.stringify(s.tags || []), JSON.stringify(s.links || []), now);
  }
  console.log(`[Seed] ${seedData.length} seed memories created`);
}

// === Message Queue ===
function pushMessage(msg) {
  state.messageQueue.push(msg);
  if (state.running && !state.processing) triggerImmediateTick();
}

function popMessage() {
  // Sort by priority: user messages before background
  state.messageQueue.sort((a, b) => {
    const aPrio = a.channel === 'system' ? 0 : 1;
    const bPrio = b.channel === 'system' ? 0 : 1;
    return aPrio - bPrio;
  });
  return state.messageQueue.shift();
}

function hasMessages() {
  return state.messageQueue.length > 0;
}

// === Tick Scheduler ===
function scheduleNextTick(overrideMs) {
  clearTimeout(state.tickTimer);
  if (!state.running) return;

  let intervalMs = overrideMs !== undefined ? overrideMs : getTickIntervalMs();

  // Check for pending messages first
  if (hasMessages()) {
    intervalMs = 0;
  } else if (shouldThrottle()) {
    intervalMs = getTickIntervalMs();
  }

  // Check for due reminders that are sooner
  const reminders = getDueReminders();
  for (const r of reminders) {
    const dueIn = new Date(r.due_at) - Date.now();
    if (dueIn < intervalMs) intervalMs = Math.max(0, dueIn);
  }

  state.tickTimer = setTimeout(onTick, Math.max(0, intervalMs));
}

function triggerImmediateTick() {
  clearTimeout(state.tickTimer);
  onTick();
}

export function rescheduleTick() {
  scheduleNextTick();
}

export function getBackgroundProcesses() {
  return [...state.backgroundProcesses.entries()].map(([pid, p]) => ({ pid, cmd: p.cmd }));
}

export function killBackgroundProcess(pid) {
  const p = state.backgroundProcesses.get(pid);
  if (p && p.child) {
    try { p.child.kill(); } catch {}
  }
  state.backgroundProcesses.delete(pid);
  return true;
}

export function addBackgroundProcess(pid, cmd, child) {
  state.backgroundProcesses.set(pid, { cmd, child });
}

// === Main Tick ===
async function onTick() {
  if (!state.running || state.processing) return;

  // Check for due reminders
  const reminders = getDueReminders();
  for (const r of reminders) {
    fireReminder(r.id);
    const msg = `[REMINDER] ${r.task}`;
    pushMessage({ content: msg, fromId: 'SYSTEM', channel: 'reminder' });
    emitSSE('reminder_fired', { id: r.id, task: r.task });
  }

  if (hasMessages()) {
    const msg = popMessage();
    await processMessage(msg);
  } else {
    const tick = formatTick();
    const existenceDesc = getExistenceDesc();
    await processMessage({ content: tick, fromId: 'SYSTEM', channel: 'tick' }, true);
  }

  scheduleNextTick();
}

// === Existence Description ===
function getExistenceDesc() {
  const birth = getConfig('birth_time');
  if (!birth) return '';
  const diffMs = Date.now() - new Date(birth).getTime();
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return `You have been running since ${new Date(birth).toISOString().slice(0, 10)} (${days}d ${hours}h).`;
}

// === Process Message ===
async function processMessage(msg, isTick = false) {
  state.processing = true;
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  try {
    emitSSE('tick', { content: msg.content, isTick });

    // 1. Injection
    const injection = await runInjector({
      message: msg.content,
      isTick,
      agentName: state.agentName,
    });

    emitSSE('injector_result', {
      keywords: injection.keywords,
      memoryCount: injection.relevantMemories.length,
    });

    // 2. Gather runtime context (weather, hotspots, location)
    const extraCtx = await gatherContext({ isTick, message: msg.content });
    const extraContextText = formatExtraContext(extraCtx);

    // 3. Build system prompt
    const systemPrompt = buildSystemPrompt({
      agentName: state.agentName,
      persona: getConfig('persona') || null,
      memories: injection.relevantMemories,
      task: injection.task,
      taskSteps: injection.taskSteps,
      conversationWindow: injection.conversationWindow,
      personMemory: injection.personMemory,
      existenceDesc: isTick ? getExistenceDesc() : null,
      extraContext: extraContextText,
    });

    emitSSE('system_prompt', { prompt: systemPrompt });

    // 3. Save incoming message
    const ts = new Date().toISOString();
    insertConversation({
      role: 'user',
      fromId: msg.fromId || 'ID:000001',
      content: msg.content,
      channel: msg.channel || (isTick ? 'tick' : 'web'),
      timestamp: ts,
    });

    // 4. LLM call
    const toolCalls = [];
    console.log('[Process] Calling LLM...');
    const llmResult = await callLLM({
      systemPrompt,
      message: msg.content,
      tools: getToolSchemas(injection.tools),
      temperature: config.temperature,
      thinking: true,
      signal,
      onToolCall: ({ name, args }) => {
        toolCalls.push({ name, args });
        emitSSE('tool_call', { name, args });
      },
      onStream: ({ mode, text }) => {
        emitSSE('stream_chunk', { mode, text });
      },
    });

    if (signal.aborted) return;

    emitSSE('stream_end', {});

    const response = llmResult.content || '';
    console.log('[Process] LLM response length:', response.length, 'content:', response.slice(0,100));

    // 5. Save response
    if (response) {
      insertConversation({
        role: 'jarvis',
        fromId: state.agentName,
        toId: msg.fromId || 'ID:000001',
        content: response,
        channel: isTick ? 'tick' : 'web',
        timestamp: new Date().toISOString(),
      });
    }

    emitSSE('response', { content: response, isTick });

    // 6. Recognition (skip for TICK to save tokens, or run in background)
    if (!isTick && response) {
      const recognizerResult = await runRecognizer({
        message: msg.content,
        response,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, result: '' })),
        agentName: state.agentName,
        task: injection.task,
      });
      if (recognizerResult) {
        state.memoryCount = getMemoryCount();
        emitSSE('memories_written', { count: state.memoryCount });
      }
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      emitSSE('processing_preempted', {});
      return;
    }
    console.error('[Process] Error:', err.message);
    emitSSE('error', { message: err.message });

    if (err.message?.includes('429')) setRateLimited();
  } finally {
    state.processing = false;
    state.abortController = null;
  }
}

// === API Handlers ===
async function handleMessage(data) {
  pushMessage({ content: data.content, fromId: data.from_id || 'ID:000001', channel: data.channel || 'web' });
  return { ok: true, agent_name: state.agentName };
}

async function handleActivate(data) {
  const r = await activate(data.provider || 'deepseek', data.apiKey, data.model, data.baseURL);
  startLoop();
  return { ok: true, ...r };
}

// === Loop Control ===
function startLoop() {
  if (state.running) return;
  state.running = true;
  console.log(`[System] AiYa (${state.agentName}) consciousness loop started`);
  emitSSE('admin', { action: 'started' });

  // Run initial self-check
  const initialMessage = {
    content: '[SYSTEM] You have just started. Perform a quick self-check: verify your sandbox is accessible, test a simple tool, and send a brief greeting to the user.',
    fromId: 'SYSTEM',
    channel: 'system',
  };
  pushMessage(initialMessage);
  scheduleNextTick(0);
}

function stopLoop() {
  state.running = false;
  clearTimeout(state.tickTimer);
  if (state.abortController) state.abortController.abort();
  console.log('[System] Consciousness loop paused');
  emitSSE('admin', { action: 'stopped' });
}

// === Main ===
function main() {
  process.on('unhandledRejection', (err) => {
    console.error('[FATAL] Unhandled rejection:', err.message);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err.message, err.stack);
  });

  const activated = init();

  // API Server
  const server = createAPI({
    getStatus: () => state.running,
    getQuotaStatus: () => getQuotaStatus(),
    getMemoryCount: () => state.memoryCount,
    getAgentName: () => state.agentName,
    getSettings: () => ({
      activated: !config.needsActivation,
      provider: config.provider,
      model: config.model,
      needsActivation: config.needsActivation,
    }),
    onMessage: handleMessage,
    onActivate: handleActivate,
    onAdminStop: stopLoop,
    onAdminStart: startLoop,
    onAdminRestart: () => {
      console.log('[System] Restarting...');
      process.exit(0);
    },
  });

  const port = parseInt(process.env.PORT) || 3721;
  server.listen(port, () => {
    console.log(`[API] AiYa running on http://127.0.0.1:${port}`);
    console.log(`[API] Chat UI: http://127.0.0.1:${port}`);
    console.log(`[API] Status:  http://127.0.0.1:${port}/status`);
  });

  // Start loop if activated
  if (activated) {
    startLoop();
  } else {
    console.log(`[System] Not activated. Open http://127.0.0.1:${port} to activate.`);
  }
}

main();
