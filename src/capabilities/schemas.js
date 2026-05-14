// Tool function-call schemas for LLM
export const TOOL_SCHEMAS = {
  send_message: {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a text message to the user. MUST call this to reply.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'Recipient ID (default: ID:000001)' },
          content: { type: 'string', description: 'Message content to send' },
        },
        required: ['content'],
      },
    },
  },

  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read contents of a file from the sandbox.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path within sandbox' },
        },
        required: ['path'],
      },
    },
  },

  list_dir: {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories in a sandbox path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, default "."' },
        },
      },
    },
  },

  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the sandbox.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },

  delete_file: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the sandbox.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to delete' },
        },
        required: ['path'],
      },
    },
  },

  make_dir: {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Create a directory in the sandbox.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' },
        },
        required: ['path'],
      },
    },
  },

  exec_command: {
    type: 'function',
    function: {
      name: 'exec_command',
      description: 'Execute a shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          background: { type: 'boolean', description: 'Run in background' },
        },
        required: ['command'],
      },
    },
  },

  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },

  fetch_url: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch content from a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
  },

  search_memory: {
    type: 'function',
    function: {
      name: 'search_memory',
      description: 'Search through stored memories to find relevant information before writing new memories.',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search for' },
        },
        required: ['keywords'],
      },
    },
  },

  upsert_memory: {
    type: 'function',
    function: {
      name: 'upsert_memory',
      description: 'Create or update a memory. For existing memories, provide mem_id to update. For new ones, leave mem_id empty.',
      parameters: {
        type: 'object',
        properties: {
          memories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                mem_id: { type: 'string', description: 'Stable semantic ID. If exists, updates; if new, created. Format: type_slug' },
                type: { type: 'string', enum: ['person', 'knowledge', 'fact', 'article', 'task_knowledge', 'opinion_expressed'], description: 'Memory type' },
                content: { type: 'string', description: 'Summary line' },
                detail: { type: 'string', description: 'Full detail' },
                title: { type: 'string', description: 'Memory title' },
                entities: { type: 'array', items: { type: 'string' }, description: 'Related entity IDs' },
                concepts: { type: 'array', items: { type: 'string' }, description: 'Concept keywords' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
                links: { type: 'array', items: { type: 'object', properties: { target_id: { type: 'string' }, relation: { type: 'string' } } }, description: 'Knowledge graph links' },
              },
              required: ['type', 'content'],
            },
          },
        },
        required: ['memories'],
      },
    },
  },

  skip_recognition: {
    type: 'function',
    function: {
      name: 'skip_recognition',
      description: 'Signal that nothing in this turn is worth remembering. Use when no new or noteworthy information was exchanged.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason for skipping' },
        },
      },
    },
  },

  set_task: {
    type: 'function',
    function: {
      name: 'set_task',
      description: 'Start a multi-step task.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Task description' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Task steps' },
        },
        required: ['description', 'steps'],
      },
    },
  },

  complete_task: {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark current task as complete.',
      parameters: { type: 'object', properties: {} },
    },
  },

  manage_reminder: {
    type: 'function',
    function: {
      name: 'manage_reminder',
      description: 'Create, list, or cancel reminders.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'cancel'], description: 'Action to perform' },
          task: { type: 'string', description: 'Reminder description (for create)' },
          due_at: { type: 'string', description: 'ISO 8601 datetime (for create)' },
          kind: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'], description: 'Recurrence type (for create)' },
          id: { type: 'number', description: 'Reminder ID (for cancel)' },
        },
        required: ['action'],
      },
    },
  },

  weather: {
    type: 'function',
    function: {
      name: 'weather',
      description: 'Get current weather for a city using wttr.in.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name (e.g. Beijing, London)' },
          lang: { type: 'string', description: 'Language code', default: 'zh' },
        },
        required: ['location'],
      },
    },
  },

  set_location: {
    type: 'function',
    function: {
      name: 'set_location',
      description: 'Set your current location for weather and context.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          country: { type: 'string', description: 'Country name or code' },
        },
        required: ['city'],
      },
    },
  },

  set_tick_interval: {
    type: 'function',
    function: {
      name: 'set_tick_interval',
      description: 'Change the autonomous heartbeat interval.',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'New interval in minutes (1-120)', minimum: 1, maximum: 120 },
        },
        required: ['minutes'],
      },
    },
  },

  generate_image: {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image from a text description.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed image description' },
          size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'], default: '512x512' },
        },
        required: ['prompt'],
      },
    },
  },

  browser_read: {
    type: 'function',
    function: {
      name: 'browser_read',
      description: 'Fetch and read content from a URL, stripping scripts and styles.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to read' },
        },
        required: ['url'],
      },
    },
  },

  speak: {
    type: 'function',
    function: {
      name: 'speak',
      description: 'Trigger text-to-speech for creative content.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak' },
          voice_id: { type: 'string', description: 'Voice ID to use' },
        },
        required: ['text'],
      },
    },
  },

  kill_process: {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Kill a background process.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'string', description: 'Process ID to kill' },
        },
        required: ['pid'],
      },
    },
  },

  list_processes: {
    type: 'function',
    function: {
      name: 'list_processes',
      description: 'List running background processes.',
      parameters: { type: 'object', properties: {} },
    },
  },

  generate_lyrics: {
    type: 'function',
    function: {
      name: 'generate_lyrics',
      description: 'Generate song lyrics from a prompt or theme.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Theme or description for lyrics' },
          style: { type: 'string', description: 'Musical style (pop, rock, ballad, etc.)' },
        },
        required: ['prompt'],
      },
    },
  },

  update_task_step: {
    type: 'function',
    function: {
      name: 'update_task_step',
      description: 'Update the status of a task step.',
      parameters: {
        type: 'object',
        properties: {
          step_index: { type: 'number', description: 'Zero-based step index' },
          status: { type: 'string', enum: ['done', 'failed', 'skipped', 'pending'], description: 'New status' },
          note: { type: 'string', description: 'Optional note about the step' },
        },
        required: ['step_index', 'status'],
      },
    },
  },
};

export function getToolSchemas(names) {
  if (!names || names.length === 0) return [];
  return names.map(n => TOOL_SCHEMAS[n]).filter(Boolean);
}

export const ALL_TOOLS = Object.keys(TOOL_SCHEMAS);
