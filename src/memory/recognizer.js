import { callLLM } from '../llm.js';
import { TOOL_SCHEMAS } from '../capabilities/schemas.js';

const RECOGNIZER_TOOLS = [
  TOOL_SCHEMAS.search_memory,
  TOOL_SCHEMAS.upsert_memory,
  TOOL_SCHEMAS.skip_recognition,
];

const RECOGNIZER_PROMPT = `You are a memory recognition system. After each conversation turn, analyze what happened and decide what is worth remembering.

Available actions:
1. search_memory(keywords) — check if similar memories already exist
2. upsert_memory({memories: [...]}) — create or update memories (provide mem_id to update existing)
3. skip_recognition(reason) — nothing worth remembering

Memory types:
- person: information about a specific person (mem_id: person_{id})
- knowledge: general knowledge, concepts, methods (mem_id: knowledge_{slug})
- fact: stable facts, preferences, states (mem_id: fact_{slug})
- article: long-form saved articles (mem_id: article_{url_hash})
- task_knowledge: insights from task execution (mem_id: task_{slug})

Rules:
- ALWAYS search_memory first for each potential memory to avoid duplicates
- If memory exists, update it with upsert_memory (provide the existing mem_id)
- If memory is new, create with upsert_memory (leave mem_id empty)
- For articles, use fetch_url or browser_read URL as source
- Consolidate related facts into single memories, don't fragment
- Skip if the turn contains no new information worth remembering
- The user's emotional state or expressed preferences are worth remembering
- Decisions made, tasks created/completed are worth remembering`;

export async function runRecognizer({ message, response, toolCalls, agentName, task }) {
  const context = [
    `## Current Time\n${new Date().toISOString()}`,
    `\n## User Message\n${(message || '').slice(0, 500)}`,
    `\n## Agent Response\n${(response || '').slice(0, 500)}`,
  ];

  if (toolCalls && toolCalls.length > 0) {
    context.push(`\n## Tool Calls Made`);
    for (const tc of toolCalls) {
      context.push(`- ${tc.name}: ${String(tc.result || '').slice(0, 200)}`);
    }
  }

  if (task) {
    context.push(`\n## Active Task\n${task}`);
  }

  try {
    const result = await callLLM({
      systemPrompt: RECOGNIZER_PROMPT,
      message: context.join('\n'),
      tools: RECOGNIZER_TOOLS,
      temperature: 0,
      thinking: false,
    });
    return result;
  } catch (e) {
    console.error('[Recognizer] Failed:', e.message);
    return null;
  }
}
