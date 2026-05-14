import { extractKeywords } from './utils.js';
import { searchMemoriesByKeywords, getConversations, getRecentConversationTimeline, getPersonMemory, getConfig } from '../db.js';
import { getToolSchemas, ALL_TOOLS } from '../capabilities/schemas.js';

export async function runInjector({ message, isTick, agentName }) {
  // Parse sender from message format: [ID:xxx] content
  let senderId = 'ID:000001';
  let content = message || '';
  if (typeof message === 'string') {
    const m = message.match(/^\[(.+?)\]\s*(.+)/s);
    if (m) { senderId = m[1]; content = m[2]; }
  }

  // Extract keywords
  const keywords = extractKeywords(content);

  // Search memories
  const relevantMemories = keywords.length > 0
    ? searchMemoriesByKeywords(keywords, 15)
    : [];

  // Get person memory for sender
  const personMemory = getPersonMemory(senderId);

  // Get conversation window
  const conversationWindow = isTick
    ? getRecentConversationTimeline(168)
    : getConversations(20);

  // Get current task
  const task = getConfig('current_task');
  const taskSteps = JSON.parse(getConfig('current_task_steps') || '[]');

  // Determine available tools
  const tools = [...ALL_TOOLS]; // All tools available

  return {
    senderId,
    content,
    keywords,
    relevantMemories,
    personMemory,
    conversationWindow,
    task: task || null,
    taskSteps,
    tools,
  };
}
