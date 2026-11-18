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
  turn.completedAt = Date.now() / 1000;
  if (typeof turn.startedAt === 'number')
    turn.durationMs = Math.max(0, Math.round((turn.completedAt - turn.startedAt) * 1000));
  thread.status = { type: 'idle' };
  save();
  if (!turn.items[0]?.content?.[0]?.text?.includes('[lost-terminal]'))
    note('turn/completed', { threadId: thread.id, turn });
}
function respond(thread: any, turn: any, slow = false) {
  const item = { id: randomUUID(), type: 'agentMessage', phase: 'final_answer', text: '' };
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
        data: [
          {
            id: 'simulated-model',
            model: 'simulated-model',
            displayName: 'Demo model',
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Quick fixture' },
              { reasoningEffort: 'medium', description: 'Balanced fixture' },
              { reasoningEffort: 'high', description: 'Careful fixture' },
            ],
          },
        ],
        nextCursor: null,
      });
    if (method === 'collaborationMode/list')
      return result(id, {
        data: [
          { name: 'Code', mode: 'default', model: 'simulated-model' },
          { name: 'Plan', mode: 'plan', model: 'simulated-model' },
        ],
      });
    if (method === 'account/read')
      return result(id, { account: { type: 'mock' }, requiresOpenaiAuth: false });
    if (method === 'thread/list') {
      const all = [...threads.values()]
        .filter((t) => t.cwd === p.cwd && !!t.archived === !!p.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
      const start = Number(p.cursor ?? 0);
      const end = start + (p.limit ?? 30);
      return result(id, {
        data: all.slice(start, end).map(summary),
        nextCursor: end < all.length ? String(end) : null,
      });
    }
    if (method === 'test/seedConversations') {
      for (let i = 0; i < Math.min(p.count ?? 0, 400); i++) {
        const t: any = create(p.cwd);
        t.name = 'Fixture conversation ' + i;
        t.updatedAt = i + 1000;
      }
      save();
      return result(id, {});
    }
    if (method === 'thread/start') {
      const thread = create(p.cwd);
      note('thread/started', { thread: summary(thread) });
      return result(id, { thread: summary(thread), model: 'simulated-model' });
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
            ...Array.from(
              { length: Math.min(Math.max(0, p.extraCommandsPerTurn ?? 0), 300) },
              (_, command) => ({
                id: `command-${i}-${command}`,
                type: 'commandExecution',
                command: `printf fixture-${command}`,
                aggregatedOutput: 'Synthetic tool output.',
                status: 'completed',
              }),
            ),
            {
              id: `agent-${i}`,
              type: 'agentMessage',
              text: `## Reference ${i}\n\n${'A completed, synthetic message. '.repeat(120)}`,
            },
          ],
        });
      save();
      return result(id, { thread: summary(thread), model: 'simulated-model' });
    }
    const thread: any = threads.get(p.threadId);
    if (!thread) return send({ id, error: { code: -32600, message: 'Thread not found' } });
    if (method === 'thread/fork') {
      const index = thread.turns.findIndex((turn: any) => turn.id === p.lastTurnId);
      if (index < 0 || thread.turns[index].status === 'inProgress')
        return send({
          id,
          error: { code: -32600, message: 'Choose a completed turn in this conversation' },
        });
      const child: any = create(thread.cwd);
      child.turns = structuredClone(thread.turns.slice(0, index + 1));
      child.name = thread.name;
      child.preview = thread.preview;
      child.forkedFromId = thread.id;
      save();
      note('thread/started', { thread: summary(child) });
      return result(id, { thread: summary(child) });
    }
    if (method === 'thread/read' || method === 'thread/resume')
      return result(id, { thread: summary(thread), model: 'simulated-model' });
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
      note('thread/name/updated', { threadId: thread.id, threadName: p.name });
      return result(id, {});
    }
    if (method === 'thread/archive' || method === 'thread/unarchive') {
      if (thread.status.type === 'active')
        return send({ id, error: { code: -32600, message: 'A turn is active' } });
      thread.archived = method === 'thread/archive';
      save();
      note(thread.archived ? 'thread/archived' : 'thread/unarchived', { threadId: thread.id });
      return result(id, thread.archived ? {} : { thread: summary(thread) });
    }
    if (method === 'thread/settings/update') {
      thread.settings = p;
      return result(id, {});
    }
    if (method === 'review/start') {
      if (thread.status.type === 'active' || thread.archived)
        return send({ id, error: { code: -32600, message: 'Conversation is busy or archived' } });
      const turn: any = {
        id: randomUUID(),
        status: 'inProgress',
        startedAt: Date.now() / 1000,
        items: [
          { id: randomUUID(), type: 'enteredReviewMode', review: 'Reviewing ' + p.target.type },
        ],
      };
      thread.turns.push(turn);
      thread.status = { type: 'active', activeFlags: [] };
      result(id, { turn, reviewThreadId: thread.id });
      note('turn/started', {
        threadId: thread.id,
        turn: { id: randomUUID(), status: 'inProgress', items: [] },
      });
      const review = {
        id: randomUUID(),
        type: 'exitedReviewMode',
        review: 'Simulated review: no model was called. Target: ' + JSON.stringify(p.target),
      };
      turn.items.push(review);
      note('item/completed', { threadId: thread.id, turnId: turn.id, item: review });
      finish(thread, turn);
      return;
    }
    if (method === 'turn/steer') {
      const turn = thread.turns.at(-1);
      if (thread.status.type !== 'active' || turn?.id !== p.expectedTurnId)
        return send({ id, error: { code: -32600, message: 'Active turn does not match' } });
      const item = {
        id: randomUUID(),
        type: 'userMessage',
        clientId: p.clientUserMessageId,
        content: p.input,
      };
      turn.items.push(item);
      save();
      note('item/completed', { threadId: thread.id, turnId: turn.id, item });
      return result(id, { turnId: turn.id });
    }
    if (method === 'turn/start') {
      if (thread.archived)
        return send({ id, error: { code: -32600, message: 'Restore the conversation first' } });
      if (thread.status.type === 'active')
        return send({ id, error: { code: -32600, message: 'A turn is already active' } });
      const text = p.input
        .filter((i: any) => i.type === 'text')
        .map((i: any) => i.text)
        .join('\n');
      const turn: any = {
        id: randomUUID(),
        status: 'inProgress',
        startedAt: Date.now() / 1000,
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
      note('thread/tokenUsage/updated', {
        threadId: thread.id,
        turnId: turn.id,
        tokenUsage: {
          last: { totalTokens: 1200 },
          total: { totalTokens: 3400 },
          modelContextWindow: 128000,
        },
      });
      if (p.collaborationMode?.mode === 'plan')
        note('turn/plan/updated', {
          threadId: thread.id,
          turnId: turn.id,
          explanation: 'Simulation plan',
          plan: [
            { step: 'Inspect the project', status: 'completed' },
            { step: 'Propose a change', status: 'inProgress' },
          ],
        });
      if (!text.includes('[lost-ack]')) result(id, { turn });
      if (text.includes('[changes]') || text.includes('[file-approve]')) {
        const diff =
          '@@ -1,3 +1,3 @@\n export function hello(name: string) {\n-  return `Hello, ${name}`;\n+  return `Welcome, ${name}`;\n }\n';
        const added =
          '@@ -0,0 +1,' +
          (text.includes('[large-patch]') ? 600 : 1) +
          ' @@\n' +
          (text.includes('[large-patch]')
            ? Array.from({ length: 600 }, (_, i) => '+Fixture line ' + i).join('\n')
            : text.includes('[truncated-patch]')
              ? ('+' + 'x'.repeat(10000) + '\n').repeat(20)
              : '+<img src=x onerror=alert(1)>') +
          '\n';
        const file = {
          id: randomUUID(),
          type: 'fileChange',
          status: text.includes('[file-approve]') ? 'inProgress' : 'completed',
          changes: [
            { path: 'example.ts', kind: { type: 'update', movePath: null }, diff },
            { path: 'new-file.txt', kind: { type: 'add' }, diff: added },
          ],
        };
        turn.items.push(file);
        note('item/started', { threadId: thread.id, turnId: turn.id, item: file });
        note('turn/diff/updated', {
          threadId: thread.id,
          turnId: turn.id,
          diff:
            'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n' +
            diff +
            'diff --git a/new-file.txt b/new-file.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new-file.txt\n' +
            added,
        });
        if (text.includes('[repeated-edits]')) {
          const again = {
            id: randomUUID(),
            type: 'fileChange',
            status: 'completed',
            changes: [
              {
                path: 'example.ts',
                kind: { type: 'update', movePath: null },
                diff: '@@ -2 +2 @@\n-  return `Welcome, ${name}`;\n+  return `Greetings, ${name}`;\n',
              },
            ],
          };
          turn.items.push(again);
          note('item/completed', { threadId: thread.id, turnId: turn.id, item: again });
          note('turn/diff/updated', {
            threadId: thread.id,
            turnId: turn.id,
            diff:
              'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n' +
              diff.replace('Welcome', 'Greetings') +
              'diff --git a/new-file.txt b/new-file.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new-file.txt\n' +
              added,
          });
        }
      }
      if (
        text.includes('[approve]') ||
        text.includes('[question]') ||
        text.includes('[file-approve]')
      ) {
        const questions = text.includes('[question]');
        const rpcId = ++serial;
        waiting.set(rpcId, {
          turnId: turn.id,
          resume: (value) => {
            note('serverRequest/resolved', { threadId: thread.id, requestId: rpcId });
            if (!questions && value?.decision !== 'accept') finish(thread, turn, 'interrupted');
            else respond(thread, turn, text.includes('[slow]'));
          },
        });
        send({
          id: rpcId,
          method: questions
            ? 'item/tool/requestUserInput'
            : text.includes('[file-approve]')
              ? 'item/fileChange/requestApproval'
              : 'item/commandExecution/requestApproval',
          params: {
            threadId: thread.id,
            turnId: turn.id,
            itemId: text.includes('[file-approve]')
              ? turn.items.find((item: any) => item.type === 'fileChange')?.id
              : randomUUID(),
            isBlocking: p.collaborationMode?.mode === 'plan',
            command: 'printf "demo approval"',
            cwd: thread.cwd,
            questions: questions
              ? [
                  {
                    id: 'direction',
                    header: 'Direction',
                    isOther: !text.includes('[no-other]'),
                    question: 'What should happen next?',
                    options: [
                      { label: 'Continue', description: 'Continue with the proposed direction.' },
                      {
                        label: 'Explain first',
                        description: 'Review the options before proceeding.',
                      },
                    ],
                  },
                  ...(text.includes('[multiple]')
                    ? [
                        {
                          id: 'private',
                          header: 'Private fixture',
                          isSecret: true,
                          isOther: true,
                          question: 'Private fixture answer',
                          options: null,
                        },
                      ]
                    : []),
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
