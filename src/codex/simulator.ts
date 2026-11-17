/** Explicit demo protocol process. It never calls a model or executes shell commands. */
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

const path = process.env.CODES_MOCK_STATE_FILE;
const threads = new Map<string, any>(
  path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [],
);
const waiting = new Map<number, { turnId: string; resume: (value: any) => void }>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
let serial = 1000;
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
const note = (method: string, params: unknown) => send({ method, params });
const result = (id: number | string, value: unknown) => send({ id, result: value });
function save() {
  if (path) {
    writeFileSync(path + '.tmp', JSON.stringify([...threads]), { mode: 0o600 });
    renameSync(path + '.tmp', path);
  }
}
function finish(thread: any, turn: any, status = 'completed') {
  clearInterval(timers.get(turn.id));
  timers.delete(turn.id);
  for (const [id, entry] of waiting)
    if (entry.turnId === turn.id) {
      waiting.delete(id);
      note('serverRequest/resolved', { threadId: thread.id, requestId: id });
    }
  turn.status = status;
  thread.status = { type: 'idle' };
  save();
  if (!turn.items[0]?.content[0]?.text.includes('[lost-terminal]'))
    note('turn/completed', { threadId: thread.id, turn });
}
function respond(thread: any, turn: any, slow = false) {
  const item = { id: randomUUID(), type: 'agentMessage', text: '' };
  turn.items.push(item);
  note('item/started', { threadId: thread.id, turnId: turn.id, item });
  const text =
    '## A clear path forward\n\nThis is a **simulated response** from the codes demo runtime. No model was called and no project files were modified.\n\n- Inspect the relevant files and their context.\n- Make a focused change in your workspace.\n- Review the diff and verify the result.\n\nYou can continue the conversation, attach a file, or start a separate task.';
  const chunks = text.match(/.{1,10}|\n/g)!;
  let i = 0;
  timers.set(
    turn.id,
    setInterval(
      () => {
        const delta = chunks[i++];
        if (delta !== undefined) {
          item.text += delta;
          note('item/agentMessage/delta', {
            threadId: thread.id,
            turnId: turn.id,
            itemId: item.id,
            delta,
          });
        } else {
          note('item/completed', { threadId: thread.id, turnId: turn.id, item });
          finish(thread, turn);
        }
      },
      slow ? 150 : 18,
    ),
  );
}
function summary(thread: any) {
  return { ...thread, turns: [] };
}
function create(cwd: string) {
  const thread = {
    id: randomUUID(),
    cwd,
    name: '',
    preview: '',
    source: 'appServer',
    status: { type: 'idle' },
    turns: [],
    createdAt: Date.now() / 1000,
    updatedAt: Date.now() / 1000,
    historyMode: 'paginated',
  };
  threads.set(thread.id, thread);
  save();
  return thread;
}
createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    const request = JSON.parse(line);
    if (!request.method) {
      const entry = waiting.get(request.id);
      waiting.delete(request.id);
      entry?.resume(request.result);
      return;
    }
    const { id, method, params: p = {} } = request;
    if (method === 'initialized') return;
    if (method === 'initialize')
      return result(id, {
        userAgent: 'codes_simulator/0.167.0',
        platformFamily: 'unix',
        platformOs: 'linux',
      });
    if (method === 'model/list')
      return result(id, {
        data: [{ id: 'simulated-model', displayName: 'Demo model', isDefault: true }],
        nextCursor: null,
      });
    if (method === 'account/read')
      return result(id, { account: { type: 'mock' }, requiresOpenaiAuth: false });
    if (method === 'thread/list')
      return result(id, {
        data: [...threads.values()].filter((t) => t.cwd === p.cwd).map(summary),
        nextCursor: null,
      });
    if (method === 'thread/start') {
      const thread = create(p.cwd);
      note('thread/started', { thread: summary(thread) });
      return result(id, { thread: summary(thread) });
    }
    if (method === 'test/seed') {
      const thread: any = create(p.cwd);
      thread.name = 'Rendering reference';
      thread.preview = 'Synthetic history';
      for (let i = 0; i < Math.min(p.count, 100); i++)
        thread.turns.push({
          id: `turn-${i}`,
          status: 'completed',
          items: [
            {
              id: `user-${i}`,
              type: 'userMessage',
              content: [{ type: 'text', text: `Reference task ${i}` }],
            },
            {
              id: `agent-${i}`,
              type: 'agentMessage',
              text: `## Reference ${i}\n\n${'A completed, synthetic message. '.repeat(120)}`,
            },
          ],
        });
      save();
      return result(id, { thread: summary(thread) });
    }
    const thread: any = threads.get(p.threadId);
    if (!thread) return send({ id, error: { code: -32600, message: 'Thread not found' } });
    if (method === 'thread/read' || method === 'thread/resume')
      return result(id, { thread: summary(thread) });
    if (method === 'thread/unsubscribe') return result(id, { status: 'unsubscribed' });
    if (method === 'thread/turns/list') {
      const end = p.cursor ? Number(p.cursor) : thread.turns.length;
      const start = Math.max(0, end - (p.limit ?? 12));
      return result(id, {
        data: thread.turns
          .slice(start, end)
          .reverse()
          .map((turn: any) => ({ ...turn, items: [], itemsView: 'summary' })),
        nextCursor: start ? String(start) : null,
      });
    }
    if (method === 'thread/items/list') {
      const turn = thread.turns.find((t: any) => t.id === p.turnId);
      const start = Number(p.cursor ?? 0);
      const end = start + (p.limit ?? 20);
      return result(id, {
        data: (turn?.items ?? []).slice(start, end).map((item: any) => ({ item })),
        nextCursor: end < (turn?.items.length ?? 0) ? String(end) : null,
      });
    }
    if (method === 'thread/name/set') {
      thread.name = p.name;
      save();
      return result(id, {});
    }
    if (method === 'turn/start') {
      if (thread.status.type === 'active')
        return send({ id, error: { code: -32600, message: 'A turn is already active' } });
      const text = p.input
        .filter((i: any) => i.type === 'text')
        .map((i: any) => i.text)
        .join('\n');
      const turn: any = {
        id: randomUUID(),
        status: 'inProgress',
        items: [
          {
            id: randomUUID(),
            type: 'userMessage',
            clientId: p.clientUserMessageId,
            content: [{ type: 'text', text }],
          },
        ],
      };
      thread.turns.push(turn);
      thread.preview = text.slice(0, 64);
      thread.updatedAt = Date.now() / 1000;
      thread.status = { type: 'active', activeFlags: [] };
      save();
      note('turn/started', { threadId: thread.id, turn });
      note('item/completed', { threadId: thread.id, turnId: turn.id, item: turn.items[0] });
      if (!text.includes('[lost-ack]')) result(id, { turn });
      if (text.includes('[approve]') || text.includes('[question]')) {
        const questions = text.includes('[question]');
        const rpcId = ++serial;
        waiting.set(rpcId, {
          turnId: turn.id,
          resume: (value) => {
            note('serverRequest/resolved', { threadId: thread.id, requestId: rpcId });
            if (!questions && value?.decision !== 'accept') finish(thread, turn, 'interrupted');
            else respond(thread, turn);
          },
        });
        send({
          id: rpcId,
          method: questions
            ? 'item/tool/requestUserInput'
            : 'item/commandExecution/requestApproval',
          params: {
            threadId: thread.id,
            turnId: turn.id,
            itemId: randomUUID(),
            command: 'printf "demo approval"',
            cwd: thread.cwd,
            questions: questions
              ? [
                  {
                    id: 'direction',
                    question: 'What should happen next?',
                    options: [{ label: 'Continue' }, { label: 'Explain first' }],
                  },
                ]
              : undefined,
          },
        });
      } else respond(thread, turn, text.includes('[slow]'));
      return;
    }
    if (method === 'turn/interrupt') {
      const turn = thread.turns.find((t: any) => t.id === p.turnId);
      if (turn) finish(thread, turn, 'interrupted');
      return result(id, {});
    }
    send({ id, error: { code: -32601, message: 'Unsupported simulator method' } });
  } catch {
    send({ id: null, error: { code: -32700, message: 'Invalid simulator request' } });
  }
});
process.stdin.on('end', () => {
  for (const timer of timers.values()) clearInterval(timer);
  process.exit(0);
});
