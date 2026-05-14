import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { exec, execSync } from 'child_process';
import { searchMemoriesByKeywords, upsertMemoryByMemId, insertReminder, getDueReminders, fireReminder, cancelReminder, setConfig, getConfig, insertActionLog } from '../db.js';
import { rescheduleTick, getBackgroundProcesses, killBackgroundProcess, addBackgroundProcess } from '../index.js';
import { setTickIntervalMinutes } from '../runtime/ticker.js';

const SANDBOX = resolve(join(process.cwd(), 'sandbox'));
if (!existsSync(SANDBOX)) mkdirSync(SANDBOX, { recursive: true });

function inSandbox(p) {
  const full = resolve(join(SANDBOX, p));
  if (!full.startsWith(SANDBOX)) throw new Error(`Path outside sandbox: ${p}`);
  return full;
}

export async function executeTool(name, args, signal) {
  const start = Date.now();
  let result = '';
  let status = 'ok';
  let error = '';

  try {
    switch (name) {
      case 'send_message': {
        result = JSON.stringify({ ok: true, sent: true, to: args.target_id || 'ID:000001', content: args.content });
        break;
      }
      case 'read_file': {
        const fp = inSandbox(args.path);
        if (!existsSync(fp)) { status = 'error'; error = 'File not found'; result = 'File not found'; break; }
        const size = statSync(fp).size;
        if (size > 500 * 1024) { result = readFileSync(fp, 'utf-8').slice(0, 500000); result += '\n[...truncated]'; }
        else result = readFileSync(fp, 'utf-8');
        break;
      }
      case 'list_dir': {
        const dp = inSandbox(args.path || '.');
        if (!existsSync(dp)) { status = 'error'; error = 'Directory not found'; result = 'Directory not found'; break; }
        const items = readdirSync(dp, { withFileTypes: true });
        result = items.map(i => `${i.isDirectory() ? '[dir]' : '[file]'} ${i.name}`).join('\n') || '(empty)';
        break;
      }
      case 'write_file': {
        const fp = inSandbox(args.path);
        const dir = fp.substring(0, fp.lastIndexOf('/'));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(fp, args.content, 'utf-8');
        // Verify
        const written = readFileSync(fp, 'utf-8').length;
        result = `File written: ${args.path} (${written} bytes)`;
        break;
      }
      case 'delete_file': {
        const fp = inSandbox(args.path);
        if (!existsSync(fp)) { status = 'error'; error = 'File not found'; result = 'File not found'; break; }
        const s = statSync(fp);
        if (s.isDirectory()) rmdirSync(fp, { recursive: true });
        else unlinkSync(fp);
        result = `Deleted: ${args.path}`;
        break;
      }
      case 'make_dir': {
        const dp = inSandbox(args.path);
        mkdirSync(dp, { recursive: true });
        result = `Directory created: ${args.path}`;
        break;
      }
      case 'exec_command': {
        try {
          const output = execSync(args.command, { timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024, cwd: SANDBOX });
          result = output || '(executed successfully, no output)';
        } catch (e) {
          status = 'error';
          error = e.message;
          result = `Command failed: ${e.message}\n${e.stdout || ''}${e.stderr || ''}`;
        }
        break;
      }
      case 'web_search': {
        try {
          const q = encodeURIComponent(args.query);
          const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, { signal });
          const html = await res.text();
          // Extract snippets
          const snippets = html.match(/class="result__snippet"[^>]*>(.*?)<\/a>/gs) || [];
          result = snippets.map((s, i) => `${i + 1}. ${s.replace(/<[^>]+>/g, '').trim()}`).join('\n').slice(0, 2000) || 'No results found.';
        } catch (e) {
          status = 'error';
          error = e.message;
          result = `Search failed: ${e.message}`;
        }
        break;
      }
      case 'fetch_url': {
        try {
          const res = await fetch(args.url, { signal, headers: { 'User-Agent': 'AiYa/1.0' } });
          const text = await res.text();
          const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          result = stripped.slice(0, 5000);
        } catch (e) {
          status = 'error';
          error = e.message;
          result = `Fetch failed: ${e.message}`;
        }
        break;
      }
      case 'search_memory': {
        const keywords = Array.isArray(args.keywords) ? args.keywords : [args.keyword || args.query || args.q || ''];
        const mems = searchMemoriesByKeywords(keywords.filter(Boolean), 10);
        result = JSON.stringify(mems.map(m => ({ id: m.id, mem_id: m.mem_id, type: m.type, content: m.content, matched_by: m.matched_by })));
        break;
      }
      case 'upsert_memory': {
        const mems = args.memories || [];
        const results = [];
        for (const m of mems) {
          const id = upsertMemoryByMemId(m.mem_id || null, {
            type: m.type || 'knowledge',
            content: m.content || '',
            detail: m.detail || '',
            title: m.title || '',
            entities: m.entities,
            concepts: m.concepts,
            tags: m.tags,
            links: m.links,
            timestamp: new Date().toISOString(),
          });
          results.push({ mem_id: m.mem_id, id, action: m.mem_id ? 'updated' : 'created' });
        }
        result = JSON.stringify({ ok: true, results });
        break;
      }
      case 'skip_recognition': {
        result = JSON.stringify({ ok: true, skipped: true, reason: args.reason || 'Nothing noteworthy' });
        break;
      }
      case 'set_task': {
        setConfig('current_task', args.description);
        setConfig('current_task_steps', JSON.stringify(args.steps || []));
        result = JSON.stringify({ ok: true, task: args.description, steps: args.steps });
        break;
      }
      case 'complete_task': {
        const task = getConfig('current_task');
        setConfig('current_task', '');
        setConfig('current_task_steps', '[]');
        result = JSON.stringify({ ok: true, completed: task });
        break;
      }
      case 'manage_reminder': {
        switch (args.action) {
          case 'create': {
            const id = insertReminder({
              userId: 'ID:000001',
              dueAt: args.due_at || new Date(Date.now() + 3600000).toISOString(),
              task: args.task || 'Reminder',
              systemMessage: `REMINDER: ${args.task || 'Reminder'}`,
              recurrenceType: args.kind || 'once',
              recurrenceConfig: null,
            }).lastInsertRowid;
            result = JSON.stringify({ ok: true, created: id, task: args.task });
            break;
          }
          case 'list': {
            const rems = getDueReminders();
            result = JSON.stringify(rems.map(r => ({ id: r.id, task: r.task, due_at: r.due_at, status: r.status, recurrence: r.recurrence_type })));
            break;
          }
          case 'cancel': {
            cancelReminder(args.id);
            result = JSON.stringify({ ok: true, cancelled: args.id });
            break;
          }
        }
        break;
      }

      case 'weather': {
        const loc = encodeURIComponent(args.location || 'beijing');
        const lang = args.lang || 'zh';
        try {
          const res = await fetch(`https://wttr.in/${loc}?format=4&lang=${lang}`, { signal });
          result = await res.text();
        } catch (e) {
          status = 'error'; error = e.message; result = `Weather fetch failed: ${e.message}`;
        }
        break;
      }

      case 'set_location': {
        setConfig('location_city', args.city);
        setConfig('location_country', args.country || '');
        result = JSON.stringify({ ok: true, location: `${args.city}${args.country ? ', ' + args.country : ''}` });
        break;
      }

      case 'set_tick_interval': {
        const mins = Math.max(1, Math.min(120, args.minutes || 20));
        setTickIntervalMinutes(mins);
        rescheduleTick();
        result = JSON.stringify({ ok: true, interval_minutes: mins });
        break;
      }

      case 'generate_image': {
        try {
          const fileName = `image_${Date.now()}.png`;
          const fp = inSandbox(fileName);
          const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}`, { signal });
          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(fp, buf);
          result = JSON.stringify({ ok: true, path: fileName, size: buf.length });
        } catch (e) {
          status = 'error'; error = e.message; result = `Image generation failed: ${e.message}`;
        }
        break;
      }

      case 'browser_read': {
        try {
          const res = await fetch(args.url, { signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AiYa/1.0)' } });
          const html = await res.text();
          const stripped = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          result = stripped.slice(0, 8000) || '(empty page)';
        } catch (e) {
          status = 'error'; error = e.message; result = `Browser read failed: ${e.message}`;
        }
        break;
      }

      case 'speak': {
        const voiceId = args.voice_id || getConfig('tts_voice') || 'zh_female_xiaohe_uranus_bigtts';
        result = JSON.stringify({ ok: true, text: (args.text || '').slice(0, 100), voice: voiceId, note: 'TTS triggered — audio played on client side' });
        break;
      }

      case 'kill_process': {
        const killed = killBackgroundProcess(args.pid);
        result = JSON.stringify({ ok: killed, pid: args.pid });
        if (!killed) { status = 'error'; error = `Process ${args.pid} not found`; }
        break;
      }

      case 'list_processes': {
        const procs = getBackgroundProcesses();
        result = JSON.stringify({ processes: procs.length === 0 ? [] : procs });
        break;
      }

      case 'generate_lyrics': {
        result = JSON.stringify({ ok: true, note: 'Lyrics generation — compose creative lyrics based on: ' + (args.prompt || '').slice(0, 100), style: args.style || 'pop' });
        break;
      }

      case 'update_task_step': {
        const steps = JSON.parse(getConfig('current_task_steps') || '[]');
        if (steps[args.step_index]) {
          steps[args.step_index] = { ...(typeof steps[args.step_index] === 'string' ? { text: steps[args.step_index] } : steps[args.step_index]), status: args.status, note: args.note || '' };
          setConfig('current_task_steps', JSON.stringify(steps));
          result = JSON.stringify({ ok: true, step: args.step_index, status: args.status });
        } else {
          status = 'error'; error = `Step ${args.step_index} not found`; result = `Step index ${args.step_index} out of range (0-${steps.length - 1})`;
        }
        break;
      }

      default: {
        status = 'error';
        error = `Unknown tool: ${name}`;
        result = `Unknown tool: ${name}`;
      }
    }
  } catch (e) {
    status = 'error';
    error = e.message;
    result = `Tool error: ${e.message}`;
  }

  const durationMs = Date.now() - start;
  insertActionLog({ tool: name, summary: `${name}(${JSON.stringify(args).slice(0, 80)})`, status, risk: 'low', argsJson: args, resultPreview: String(result).slice(0, 200), error, durationMs });

  return result;
}

export function isToolFailure(result) {
  if (!result) return false;
  const s = String(result);
  return s.includes('Tool error') || s.includes('Command failed') || s.includes('Search failed') || s.includes('Fetch failed');
}
