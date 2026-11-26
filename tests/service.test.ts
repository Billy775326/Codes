import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store';
import { Service } from '../src/server/service';
import { Driver } from '../src/codex/driver';
import { AppError } from '../src/shared/errors';
import type { Thread } from '../src/shared/types';
const cleanup: (() => Promise<void>)[] = [];
it('confirms follow-up acceptance from its native user item while the turn is still running', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[hold] Follow-up recovery', thread.settings);
  const turnId = thread.turnId!;
  const delivered = randomUUID();
  const missing = randomUUID();
  const text = 'An identical follow-up';
  await service.steer(thread.id, delivered, turnId, text);
  service.store.update(delivered, 'unknown');
  service.store.begin(missing, thread.id, 'steer', { expectedTurnId: turnId, prompt: text }, text);
  service.store.update(missing, 'unknown');
  const checked = await service.reconcile(thread.id);
  expect(checked.state).toBe('running');
  expect(checked.pending?.state).toBe('acknowledged');
  expect(checked.steering).toEqual([
    expect.objectContaining({ id: delivered, state: 'acknowledged', turnId }),
    expect.objectContaining({ id: missing, state: 'unknown' }),
  ]);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.store.operation(delivered)?.state).toBe('completed');
  expect(service.store.operation(missing)?.state).toBe('unknown');
});
it('keeps future conversation choices independent of an active task and captured queue settings', async () => {
  const { service, thread } = await fixture();
  const before = { ...thread.settings };
  await service.send(thread.id, randomUUID(), '[hold] Settings execution fixture', before);
  const first = randomUUID();
  await service.enqueue(thread.id, first, {
    text: 'Captured before settings change',
    settings: before,
    attachments: [],
  });
  const spy = vi.spyOn(service.driver, 'call');
  const next = {
    permission: 'workspace-write' as const,
    effort: 'high',
    fast: true,
    mode: 'plan' as const,
  };
  service.saveConversationSettings(thread.id, 0, next);
  expect(spy).not.toHaveBeenCalled();
  expect(thread.settings).toEqual(before);
  expect(thread.composerSettings?.settings).toEqual(next);
  expect(service.store.queue.get(first)?.settings).toEqual(before);
  await service.interrupt(thread.id);
  service.controlQueue(thread.id, false);
  await until(() => service.store.queue.get(first)?.state === 'completed');
  expect(thread.settings).toEqual(before);
  expect(service.store.settingsProfile(thread.id).settings).toEqual(next);
});
it('keeps saved legacy defaults out of subsequently created conversations', async () => {
  const { service, project, thread } = await fixture();
  const initial = service.store.settingsProfile(thread.id);
  const next = {
    permission: 'workspace-write' as const,
    model: 'simulated-model',
    effort: 'high',
    mode: 'plan' as const,
    fast: true,
  };
  service.saveDefaultSettings(0, next);
  expect(service.store.settingsProfile(thread.id)).toEqual(initial);
  const created = await service.create(project.id);
  expect(created.composerSettings?.settings).toEqual({});
  expect(created.settings).toEqual({});
  expect(service.store.activeCount()).toBe(0);
});
it('hydrates history without eager turn items and keeps large tool payloads outside snapshots', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Bounded native history fixture', thread.settings);
  await until(() => thread.state === 'completed');
  const call = service.driver.call.bind(service.driver);
  let largeItem = false;
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method === 'thread/turns/list') expect(params).toMatchObject({ itemsView: 'notLoaded' });
    if (method === 'thread/items/list') expect(params).toMatchObject({ limit: 1 });
    const result = await call(method, params, timeout);
    if (method === 'thread/items/list' && !largeItem && result.data.length) {
      const entry = result.data[0];
      entry.item = {
        id: entry.item.id,
        type: 'mcpToolCall',
        server: 'fixture',
        tool: 'large-result',
        status: 'completed',
        result: { content: 'x'.repeat(6 * 1024 * 1024) },
      };
      largeItem = true;
    }
    return result;
  });
  const history = await service.history(thread.id);
  expect(largeItem).toBe(true);
  expect(history.messages.some((item) => item.text === 'Used fixture: large-result')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThan(2 * 1024 * 1024);
});
it('retains native turn timing and reply phase through live events and paginated history reload', async () => {
  const { service, thread } = await fixture();
  await service.send(
    thread.id,
    randomUUID(),
    'Native transcript metadata fixture',
    thread.settings,
  );
  await until(() => thread.state === 'completed');
  const live = thread.turns?.find((turn) => turn.id === thread.turnId);
  expect(live?.startedAtMs).toBeGreaterThan(0);
  expect(live?.completedAtMs).toBeGreaterThanOrEqual(live!.startedAtMs!);
  expect(live?.durationMs).toBeGreaterThanOrEqual(0);
  expect(thread.messages.filter((message) => message.kind === 'assistant').at(-1)?.phase).toBe(
    'final_answer',
  );
  const history = await service.history(thread.id);
  expect(history.turns.at(-1)).toEqual(live);
  expect(history.messages.filter((message) => message.kind === 'assistant').at(-1)?.phase).toBe(
    'final_answer',
  );
});
it('pages native history in both directions with opaque cursors and no lost turn at the reverse anchor', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', { cwd: project.path, count: 40 });
  await service.list(project.id);
  const latest = await service.history(seeded.thread.id);
  const restarted = await service.history(
    seeded.thread.id,
    Buffer.from(JSON.stringify({ id: seeded.thread.id, cursor: '', direction: 'older' })).toString(
      'base64url',
    ),
  );
  expect(restarted.turns).toEqual(latest.turns);
  expect(restarted.hasNewer).toBe(false);
  const older = await service.history(seeded.thread.id, latest.olderCursor!);
  expect(older.hasNewer).toBe(true);
  expect(older.newerCursor).toBeTruthy();
  const forward = await service.history(seeded.thread.id, older.newerCursor!);
  expect(forward.turns[0]?.id).toBe(older.turns.at(-1)?.id);
  const last = forward.hasNewer
    ? await service.history(seeded.thread.id, forward.newerCursor!)
    : forward;
  expect(last.hasNewer).toBe(false);
  expect(last.turns.at(-1)?.id).toBe(latest.turns.at(-1)?.id);
  expect(last.newerCursor).toBeTruthy();
  await expect(
    service.history(
      seeded.thread.id,
      Buffer.from(
        JSON.stringify({ id: seeded.thread.id, cursor: '0', direction: 'invalid' }),
      ).toString('base64url'),
    ),
  ).rejects.toMatchObject({ code: 'HISTORY_CURSOR' });
});
it('shrinks dense history pages without skipping or duplicating older turns', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 8,
    extraCommandsPerTurn: 40,
  });
  await service.list(project.id);
  const id = seeded.thread.id;
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await service.history(id, cursor);
    expect(page.messages.length).toBeLessThanOrEqual(240);
    for (const turn of page.turns) {
      expect(seen.has(turn.id)).toBe(false);
      seen.add(turn.id);
    }
    expect(page.messages.filter((message) => message.kind === 'command')).toHaveLength(
      page.turns.length * 40,
    );
    cursor = page.olderCursor ?? undefined;
    pages++;
  } while (cursor && pages < 10);
  expect(cursor).toBeUndefined();
  expect(seen.size).toBe(8);
  expect(pages).toBeGreaterThan(1);
  const loaded = await service.read(id);
  expect(loaded.state).toBe('completed');
  expect(loaded.messages.length).toBeGreaterThan(0);
});
it('keeps an explicit limit for a single oversized turn', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 1,
    extraCommandsPerTurn: 250,
  });
  await service.list(project.id);
  await expect(service.history(seeded.thread.id)).rejects.toMatchObject({
    code: 'HISTORY_LIMIT',
    status: 413,
  });
});
it('does not regress a proven terminal result when its acknowledgement times out later', async () => {
  const { service, thread } = await fixture(1400);
  const id = randomUUID();
  await expect(service.send(thread.id, id, '[lost-ack]', thread.settings)).resolves.toMatchObject({
    state: 'completed',
  });
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(service.store.active(thread.id)).toBeUndefined();
});
it('retains cancellation intent across the CLI runner startup window', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[slow]', thread.settings);
  const call = service.driver.call.bind(service.driver);
  let starting = true;
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method === 'turn/interrupt' && starting) {
      starting = false;
      throw new AppError('CLI_ERROR', 'no active turn to interrupt', 409);
    }
    return call(method, params, timeout);
  });
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(thread.pending).toBeUndefined();
});
it('keeps a completed result when completion races with an interrupt request', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Hello', thread.settings);
  await until(() => thread.state === 'completed');
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    if (method === 'turn/interrupt')
      throw new AppError('CLI_ERROR', 'no active turn to interrupt', 409);
    return call(method, params, timeout);
  });
  await expect(service.interrupt(thread.id)).resolves.toMatchObject({ alreadyFinished: true });
  expect(thread.state).toBe('completed');
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it('evicts idle native subscriptions without losing a waiting approval or resumed history', async () => {
  const { service, project, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Before cache eviction', thread.settings);
  await until(() => thread.state === 'completed');
  const waiting = await service.create(project.id, thread.settings);
  await service.send(waiting.id, randomUUID(), '[approve]', waiting.settings);
  await until(() => waiting.actions.length > 0);
  for (let i = 0; i < 22; i++) await service.create(project.id, thread.settings);
  const resumed = await service.read(thread.id);
  expect(resumed.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
  await service.send(resumed.id, randomUUID(), 'After cache eviction', resumed.settings);
  await until(() => resumed.state === 'completed');
  expect(resumed.messages.filter((m) => m.kind === 'user')).toHaveLength(2);
  await service.answer(waiting.actions[0]!.id, randomUUID(), { decision: 'decline' });
  await until(() => waiting.state === 'interrupted');
});
async function fixture(timeoutMs = 2000) {
  const directory = await mkdtemp(join(tmpdir(), 'codes-service-'));
  const service = new Service(
    new Store(directory),
    new Driver('mock', { stateFile: join(directory, 'history.json'), timeoutMs }),
  );
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory, 'Fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  return { service, project, thread, directory };
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 6000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Condition did not become true');
    await new Promise((r) => setTimeout(r, 15));
  }
}
it('identifies an unanswered question after a service restart without replaying the turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-question-restart-'));
  const open = () =>
    new Service(
      new Store(directory),
      new Driver('mock', { stateFile: join(directory, 'history.json') }),
    );
  let service = open();
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory, 'Restart fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  await service.send(thread.id, randomUUID(), '[question]', { ...thread.settings, mode: 'plan' });
  await until(() => thread.state === 'waitingInput');
  const actionId = thread.actions[0]!.id;
  expect(thread.expiredQuestion).toBe(false);
  await service.close();
  service = open();
  const restored = await service.read(thread.id);
  expect(restored).toMatchObject({ state: 'unknown', expiredQuestion: true, actions: [] });
  expect(service.summaries(project.id)).toContainEqual(
    expect.objectContaining({ id: thread.id, executionUnknown: true, expiredQuestion: true }),
  );
  await expect(
    service.answer(actionId, randomUUID(), { answers: { direction: 'Continue' } }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  await service.reconcile(thread.id);
  expect(restored.expiredQuestion).toBe(true);
  expect(restored.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
});
it('restores async question attention before opening the conversation and dismisses it without creating a turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-async-question-restart-'));
  const open = () =>
    new Service(
      new Store(directory),
      new Driver('mock', { stateFile: join(directory, 'history.json') }),
    );
  let service = open();
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory);
  const thread = await service.create(project.id);
  await service.send(thread.id, randomUUID(), '[async-question]', thread.settings);
  await until(() => thread.state === 'completed');
  const action = service.conversationActions(thread.id)[0]!;
  expect(action).toMatchObject({ async: true, status: 'pending' });
  await service.close();
  service = open();
  expect(service.summaries(project.id)).toContainEqual(
    expect.objectContaining({
      id: thread.id,
      state: 'completed',
      sidebarActivity: 'optionalInput',
    }),
  );
  const receipt = randomUUID();
  await service.answer(action.id, receipt, { decision: 'skip' });
  await expect(service.answer(action.id, receipt, { decision: 'skip' })).resolves.toMatchObject({
    id: receipt,
    state: 'completed',
  });
  expect(service.summaries(project.id)[0]?.sidebarActivity).toBeUndefined();
  const restored = await service.read(thread.id);
  expect(restored.turns).toHaveLength(1);
  expect(service.conversationActions(thread.id)[0]).toMatchObject({
    status: 'answered',
    skipped: true,
  });
});
it('sends at most one async question reply to the running turn when two clients answer', async () => {
  const { service, project, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[async-question] [hold]', thread.settings);
  await until(() => service.conversationActions(thread.id).some((action) => action.async));
  const action = service.conversationActions(thread.id)[0]!;
  const turn = thread.turnId;
  expect(thread.state).toBe('running');
  const answers = { [action.questions![0]!.id]: 'Small change' };
  const results = await Promise.allSettled([
    service.answer(action.id, randomUUID(), { answers }),
    service.answer(action.id, randomUUID(), { answers }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(thread.turnId).toBe(turn);
  expect(thread.state).toBe('running');
  await until(() => service.conversationActions(thread.id)[0]?.status === 'answered');
  expect(service.summaries(project.id)[0]?.sidebarActivity).toBeUndefined();
  expect(thread.messages.filter((message) => message.answeredQuestions)).toHaveLength(1);
  await service.interrupt(thread.id);
});
it('records a confirmed reply on the original question even when the CLI has not echoed its item', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[async-question] [hold]', thread.settings);
  await until(() => service.conversationActions(thread.id).some((action) => action.async));
  const action = service.conversationActions(thread.id)[0]!;
  const question = action.questions![0]!;
  const turnId = thread.turnId;
  const nativeCall = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation((method, params, timeout) =>
      method === 'turn/steer' ? Promise.resolve({ turnId }) : nativeCall(method, params, timeout),
    );
  const receiptId = randomUUID();
  try {
    await expect(
      service.answer(action.id, receiptId, {
        answers: { [question.id]: 'Keep the original placement' },
      }),
    ).resolves.toMatchObject({ id: receiptId, state: 'acknowledged', turnId });
    expect(thread.messages.some((item) => item.answeredQuestions)).toBe(false);
    expect(service.conversationActions(thread.id)[0]).toMatchObject({
      id: action.id,
      afterMessageId: action.afterMessageId,
      status: 'answered',
      submittedAnswers: { [question.id]: 'Keep the original placement' },
    });
    expect(thread.steering).toMatchObject([{ id: receiptId, questionReply: true, text: '' }]);
    await expect(
      service.answer(action.id, randomUUID(), { answers: { [question.id]: 'Do not send again' } }),
    ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  } finally {
    spy.mockRestore();
    await service.interrupt(thread.id);
  }
});

it('accepts a legacy card reply under the live request ID and prevents another submission', async () => {
  const { service, thread } = await fixture();
  await service.send(
    thread.id,
    randomUUID(),
    '[async-question] [legacy-id] [hold]',
    thread.settings,
  );
  await until(() => service.conversationActions(thread.id).some((action) => action.async));
  await service.history(thread.id);
  const [action] = service.conversationActions(thread.id);
  const alternate = service.store.db
    .prepare('SELECT id FROM async_question_items WHERE thread_id=? AND item_id=?')
    .get(thread.id, 'item-3') as { id: string };
  const [legacyQuestionId] = Object.keys(action!.legacyQuestion!.questionIds);
  await service.answer(alternate.id, randomUUID(), {
    answers: { [legacyQuestionId!]: 'Small change' },
  });
  expect(service.conversationActions(thread.id)).toMatchObject([
    {
      id: action!.id,
      status: 'answered',
      submittedAnswers: { [action!.questions![0]!.id]: 'Small change' },
    },
  ]);
  await expect(service.answer(action!.id, randomUUID(), { answers: {} })).rejects.toMatchObject({
    code: 'STALE_ACTION',
  });
  expect(thread.messages.filter((entry) => entry.answeredQuestions)).toHaveLength(1);
  await service.interrupt(thread.id);
});

it('lets optional Code questions be explicitly skipped and resumes the same native task', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[question]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  expect(action.blocking).toBe(false);
  const turn = thread.turnId;
  const receipt = randomUUID();
  await service.answer(action.id, receipt, { decision: 'skip' });
  await service.answer(action.id, receipt, { decision: 'skip' });
  await until(() => thread.state === 'running');
  await until(() => thread.state === 'completed');
  expect(thread.turnId).toBe(turn);
  expect(thread.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
  expect(thread.actions.every((a) => a.status === 'answered')).toBe(true);
});
it('keeps Plan questions required and rejects stale questions without journaling a reply', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[question]', { ...thread.settings, mode: 'plan' });
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  expect(action.blocking).toBe(true);
  const operation = randomUUID();
  await expect(service.answer(action.id, operation, { decision: 'skip' })).rejects.toMatchObject({
    code: 'INVALID_ANSWER',
  });
  expect(service.store.operation(operation)).toBeUndefined();
  service.driver.emit('request', {
    id: 900099,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: thread.id,
      turnId: 'old-turn',
      isBlocking: false,
      questions: [{ id: 'stale', question: 'Old question' }],
    },
  });
  expect(thread.actions).toHaveLength(1);
  await service.answer(action.id, randomUUID(), { answers: { direction: 'Continue' } });
  await until(() => thread.state === 'completed');
});
it('retains structured file patches in native history and rejects a diff from another turn', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[changes]', thread.settings);
  await until(() => thread.state === 'completed');
  expect(thread.messages.find((m) => m.kind === 'change')?.files).toEqual([
    expect.objectContaining({ path: 'example.ts', kind: 'update' }),
    expect.objectContaining({ path: 'new-file.txt', kind: 'add' }),
  ]);
  const history = await service.history(thread.id);
  expect(history.messages.find((m) => m.kind === 'change')?.files).toHaveLength(2);
  const previous = thread.diff;
  service.driver.emit('notification', {
    method: 'turn/diff/updated',
    params: { threadId: thread.id, turnId: 'old-turn', diff: 'stale patch' },
  });
  expect(thread.diff).toBe(previous);
});
it('exposes truncation for oversized native patches and command output', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[changes] [truncated-patch]', thread.settings);
  await until(() => thread.state === 'completed');
  expect(thread.diffTruncated).toBe(true);
  expect(thread.messages.find((m) => m.kind === 'change')?.truncated).toBe(true);
  service.driver.emit('notification', {
    method: 'item/completed',
    params: {
      threadId: thread.id,
      turnId: thread.turnId,
      item: {
        id: 'output',
        type: 'commandExecution',
        command: 'example',
        aggregatedOutput: 'x'.repeat(150000),
        status: 'completed',
      },
    },
  });
  expect(thread.messages.find((m) => m.id === 'output')).toMatchObject({ truncated: true });
  expect(thread.messages.find((m) => m.id === 'output')!.text.length).toBeLessThanOrEqual(
    128 * 1024,
  );
});
it('streams one user message and one response for duplicate sends', async () => {
  const { service, thread } = await fixture();
  const id = randomUUID();
  const settings = { permission: 'read-only' } as const;
  await Promise.all([
    service.send(thread.id, id, 'Hello', settings),
    service.send(thread.id, id, 'Hello', settings),
  ]);
  await until(() => thread.state === 'completed');
  expect(thread.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
  expect(thread.messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
  expect(thread.messages.at(-1)?.text).toContain('simulated response');
  expect(service.store.operation(id)?.state).toBe('completed');
});
it('keeps approval pending without a browser and accepts a single answer', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  expect(thread.state).toBe('waitingApproval');
  const action = thread.actions[0]!;
  const op = randomUUID();
  await service.answer(action.id, op, { decision: 'accept' });
  await service.answer(action.id, op, { decision: 'accept' });
  await expect(
    service.answer(action.id, randomUUID(), { decision: 'accept' }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  await expect(service.answer(action.id, op, { decision: 'decline' })).rejects.toMatchObject({
    code: 'OPERATION_CONFLICT',
  });
  await until(() => thread.state === 'completed');
});
it('declines an approval without simulating successful execution', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'decline' });
  await until(() => thread.state === 'interrupted');
  expect(thread.messages.some((m) => m.kind === 'assistant')).toBe(false);
});
it('validates all question answers before resolving a request', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[question]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await expect(service.answer(action.id, randomUUID(), { answers: {} })).rejects.toMatchObject({
    code: 'ANSWER_REQUIRED',
  });
  await service.answer(action.id, randomUUID(), { answers: { direction: 'Continue' } });
  await until(() => thread.state === 'completed');
});
it('interrupts the actual task and clears its approval lifecycle', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  await expect(
    service.answer(action.id, randomUUID(), { decision: 'accept' }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  expect(thread.pending).toBeUndefined();
});
it('reconciles a lost acknowledgement and lost terminal notification by client message ID', async () => {
  const { service, thread } = await fixture(1400);
  const id = randomUUID();
  await expect(
    service.send(thread.id, id, '[lost-ack] [lost-terminal]', thread.settings),
  ).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' });
  expect(service.store.operation(id)?.state).toBe('unknown');
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await expect(
    service.send(thread.id, randomUUID(), 'duplicate?', thread.settings),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  await service.reconcile(thread.id);
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(service.store.operation(id)?.state).toBe('completed');
  expect(thread.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
});
it('ignores terminal events for a different turn when clearing an execution lease', async () => {
  const { service, thread } = await fixture();
  const id = randomUUID();
  await service.send(thread.id, id, '[slow]', thread.settings);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: 'unrelated', status: 'completed', items: [] } },
  });
  expect(service.store.active(thread.id)?.id).toBe(id);
  await service.interrupt(thread.id);
});
it('paginates native history instead of loading every turn', async () => {
  const { service, project } = await fixture();
  await service.driver.call('test/seed', { cwd: project.path, count: 100 });
  const list = await service.list(project.id);
  const seed = list.find((t) => t.title === 'Rendering reference')!;
  const page = await service.history(seed.id);
  expect(page.messages).toHaveLength(24);
  expect(page.olderCursor).toBeTruthy();
  const older = await service.history(seed.id, page.olderCursor!);
  expect(older.messages).toHaveLength(24);
  expect(older.messages[0]?.id).not.toBe(page.messages[0]?.id);
});
it('opts into hidden project paths while rejecting traversal, private data, and external symlinks', async () => {
  const { service, project, directory, thread } = await fixture();
  await mkdir(join(directory, '.settings'));
  await writeFile(join(directory, '.settings', '.options'), 'Fixture option');
  await symlink(join(directory, '.settings', '.options'), join(directory, 'visible-alias'));
  await symlink('/etc', join(directory, 'outside'));
  for (const path of ['../passwd', '.settings/.options', 'visible-alias', 'outside/passwd'])
    await expect(service.file(project.id, path)).rejects.toMatchObject({ code: 'PATH_DENIED' });
  expect(await service.files(project.id)).not.toContainEqual(
    expect.objectContaining({ name: '.settings' }),
  );
  expect(await service.files(project.id, '', true)).toContainEqual({
    name: '.settings',
    path: '.settings',
    directory: true,
  });
  expect(await service.conversationFiles(thread.id, '.settings', true)).toEqual([
    { name: '.options', path: '.settings/.options', directory: false },
  ]);
  expect(await service.conversationFile(thread.id, '.settings/.options', true)).toMatchObject({
    text: 'Fixture option',
  });
  for (const path of ['../passwd', 'outside/passwd', directory + '/.settings/.options'])
    await expect(service.file(project.id, path, true)).rejects.toMatchObject({
      code: 'PATH_DENIED',
    });
  const parent = await service.addProject(dirname(directory));
  await expect(service.files(parent.id, basename(directory), true)).rejects.toMatchObject({
    code: 'PATH_DENIED',
  });
});
it('rejects stale context but still returns an existing operation receipt after files change', async () => {
  const { service, project, directory, thread } = await fixture();
  await writeFile(join(directory, 'example.ts'), 'first\nsecond\n');
  const file = await service.file(project.id, 'example.ts');
  const attachments = [{ path: file.path, sha: file.sha, fromLine: 1, toLine: 2 }];
  const id = randomUUID();
  await service.send(thread.id, id, 'Read the file', thread.settings, attachments);
  await writeFile(join(directory, 'example.ts'), 'changed');
  expect(
    await service.send(thread.id, id, 'Read the file', thread.settings, attachments),
  ).toMatchObject({ id });
  await until(() => thread.state === 'completed');
  await expect(
    service.send(thread.id, randomUUID(), 'Read again', thread.settings, attachments),
  ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
});
it('expires live approvals and blocks accidental resends after the runtime exits', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve]', thread.settings);
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  await service.driver.stop();
  expect(thread.state).toBe('unknown');
  expect(action.status).toBe('expired');
  await expect(
    service.send(thread.id, randomUUID(), 'Again', thread.settings),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
});

it('renames native conversations without interrupting their task or changing its receipt', async () => {
  const { service, thread } = await fixture();
  const sendId = randomUUID();
  await service.send(thread.id, sendId, '[approve] Rename while working', thread.settings);
  await until(() => thread.actions.length > 0);
  const renameId = randomUUID();
  await expect(service.rename(thread.id, renameId, 'Focused work')).resolves.toMatchObject({
    title: 'Focused work',
    executionPending: true,
  });
  await expect(service.rename(thread.id, renameId, 'Focused work')).resolves.toMatchObject({
    title: 'Focused work',
  });
  await expect(service.rename(thread.id, renameId, 'Other')).rejects.toMatchObject({
    code: 'OPERATION_CONFLICT',
  });
  expect(service.store.active(thread.id)?.id).toBe(sendId);
  expect(
    (await service.driver.call('thread/read', { threadId: thread.id, includeTurns: false })).thread
      .name,
  ).toBe('Focused work');
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await service.interrupt(thread.id);
});
it('paginates beyond 200 conversations, searches titles without case sensitivity, and scopes cursors', async () => {
  const { service, project } = await fixture();
  await service.driver.call('test/seedConversations', { cwd: project.path, count: 250 });
  const seen = new Set<string>();
  let cursor: string | undefined;
  let firstCursor = '';
  do {
    const page = await service.conversations(project.id, { cursor });
    expect(page.data.length).toBeLessThanOrEqual(30);
    for (const row of page.data) {
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
    }
    cursor = page.nextCursor ?? undefined;
    firstCursor ||= cursor ?? '';
  } while (cursor);
  expect(seen.size).toBe(251);
  const found = await service.conversations(project.id, { search: 'FIXTURE CONVERSATION 24' });
  expect(found.data).toHaveLength(10);
  expect(found.data.every((row) => row.title.startsWith('Fixture conversation 24'))).toBe(true);
  await expect(
    service.conversations(project.id, { cursor: firstCursor, archived: true }),
  ).rejects.toMatchObject({ code: 'LIST_CURSOR' });
  await expect(
    service.conversations(project.id, { cursor: firstCursor, search: 'changed' }),
  ).rejects.toMatchObject({ code: 'LIST_CURSOR' });
  await expect(service.conversations(project.id, { cursor: 'invalid' })).rejects.toMatchObject({
    code: 'LIST_CURSOR',
  });
});
it('archives and restores native history while refusing new work in the archived view', async () => {
  const { service, project, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'Keep this history', thread.settings);
  await until(() => thread.state === 'completed');
  const id = randomUUID();
  await expect(service.archive(thread.id, id, true)).resolves.toMatchObject({
    archived: true,
    managementPending: false,
  });
  await expect(service.archive(thread.id, id, true)).resolves.toMatchObject({ archived: true });
  expect((await service.conversations(project.id)).data).toHaveLength(0);
  expect((await service.conversations(project.id, { archived: true })).data).toHaveLength(1);
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(1);
  await expect(
    service.send(thread.id, randomUUID(), 'Forbidden', thread.settings),
  ).rejects.toMatchObject({ code: 'CONVERSATION_ARCHIVED' });
  await expect(service.archive(thread.id, randomUUID(), false)).resolves.toMatchObject({
    archived: false,
  });
  await service.send(thread.id, randomUUID(), 'After restoration', thread.settings);
  await until(() => thread.state === 'completed');
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(2);
});
it('keeps an uncertain archive protected until native evidence proves its result', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      if (method === 'thread/archive')
        throw new AppError('RPC_TIMEOUT', 'Test-only lost acknowledgement', 504, true);
      return call(method, params, timeout);
    });
  const id = randomUUID();
  await expect(service.archive(thread.id, id, true)).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
  expect(service.store.thread(thread.id)?.managementPending).toBe(true);
  await expect(
    service.send(thread.id, randomUUID(), 'Do not dispatch', thread.settings),
  ).rejects.toMatchObject({ code: 'MANAGEMENT_BUSY' });
  await service.checkManagement(thread.id);
  expect(service.store.operation(id)?.state).toBe('unknown');
  spy.mockRestore();
  await call('thread/archive', { threadId: thread.id });
  await until(() => service.store.operation(id)?.state === 'completed');
  expect(service.store.thread(thread.id)).toMatchObject({
    archived: true,
    managementPending: false,
  });
});
it('does not import a stale list title over a concurrent native rename', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const response = await call(method, params, timeout);
      if (method === 'thread/list') {
        captured();
        await paused;
      }
      return response;
    });
  const listing = service.conversations(project.id);
  await ready;
  await service.rename(thread.id, randomUUID(), 'New title wins');
  release();
  expect((await listing).data.find((row) => row.id === thread.id)?.title).toBe('New title wins');
  spy.mockRestore();
});
it('does not replace the first task title with an earlier empty native list response', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const response = await call(method, params, timeout);
      if (method === 'thread/list') {
        captured();
        await paused;
      }
      return response;
    });
  const listing = service.conversations(project.id);
  await ready;
  await service.send(thread.id, randomUUID(), '[approve] First task title', thread.settings);
  await until(() => thread.actions.length > 0);
  release();
  expect((await listing).data.find((row) => row.id === thread.id)?.title).toBe(
    '[approve] First task title',
  );
  expect(thread.title).toBe('[approve] First task title');
  spy.mockRestore();
  await service.interrupt(thread.id);
});

it('dispatches queued messages in FIFO order only after the active task completes', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Hold the queue', thread.settings);
  await until(() => thread.actions.length > 0);
  const id = randomUUID();
  await service.enqueue(thread.id, id, {
    text: 'First queued',
    settings: thread.settings,
    attachments: [],
  });
  await service.enqueue(thread.id, id, {
    text: 'First queued',
    settings: thread.settings,
    attachments: [],
  });
  await expect(
    service.enqueue(thread.id, id, {
      text: 'Changed input',
      settings: thread.settings,
      attachments: [],
    }),
  ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  await service.enqueue(thread.id, randomUUID(), {
    text: 'Second queued',
    settings: thread.settings,
    attachments: [],
  });
  expect(service.queueState(thread.id).items).toHaveLength(2);
  await expect(service.archive(thread.id, randomUUID(), true)).rejects.toMatchObject({
    code: 'CONVERSATION_ACTIVE',
  });
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'accept' });
  await until(
    () => service.queueState(thread.id).items.length === 0 && thread.state === 'completed',
  );
  expect(thread.messages.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([
    '[approve] Hold the queue',
    'First queued',
    'Second queued',
  ]);
});
it('dequeues accepted messages while execution is active and still pauses followers when stopped', async () => {
  const { service, thread } = await fixture();
  const first = randomUUID(),
    next = randomUUID();
  const payload = {
    text: '[hold] Accepted queued task',
    settings: thread.settings,
    attachments: [],
  };
  await service.enqueue(thread.id, first, payload);
  await until(() => service.store.queue.get(first)?.state === 'sent');
  expect(thread.state).toBe('running');
  expect(service.queueState(thread.id).items).toEqual([]);
  expect(service.store.thread(thread.id)?.queueCount).toBe(0);
  // An execution acknowledgement can become uncertain after confirmed delivery.
  service.store.update(first, 'unknown', thread.turnId);
  await service.reconcile(thread.id);
  expect(service.store.queue.get(first)?.state).toBe('sent');
  expect(service.queueState(thread.id).items).toEqual([]);
  expect(service.store.thread(thread.id)?.executionUnknown).toBe(true);
  expect(() => service.cancelQueued(thread.id, first)).toThrow(/already be executing/);
  await service.enqueue(thread.id, next, { ...payload, text: 'After accepted execution' });
  expect(() => service.controlQueue(thread.id, false)).toThrow(/Check unknown results/);
  await service.enqueue(thread.id, first, payload);
  expect(service.queueState(thread.id).items.map((item) => item.id)).toEqual([next]);
  expect(service.store.queue.get(next)?.state).toBe('queued');
  expect(thread.messages.filter((item) => item.kind === 'user')).toHaveLength(1);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.store.queue.get(first)?.state).toBe('completed');
  expect(service.queueState(thread.id)).toMatchObject({ paused: true });
  expect(service.queueState(thread.id).items.map((item) => item.id)).toEqual([next]);
  service.controlQueue(thread.id, false);
  await until(() => service.store.queue.get(next)?.state === 'completed');
  expect(service.queueState(thread.id).items).toEqual([]);
  expect(thread.messages.filter((item) => item.kind === 'user').map((item) => item.text)).toEqual([
    payload.text,
    'After accepted execution',
  ]);
});
it('pauses, edits, and removes waiting messages without cancelling the active task', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Editing fixture', thread.settings);
  await until(() => thread.actions.length > 0);
  const first = randomUUID(),
    second = randomUUID();
  await service.enqueue(thread.id, first, {
    text: 'Remove this',
    settings: thread.settings,
    attachments: [],
  });
  await service.enqueue(thread.id, second, {
    text: 'Edit this',
    settings: thread.settings,
    attachments: [],
  });
  service.controlQueue(thread.id, true);
  service.editQueued(thread.id, second, 'Edited queued message');
  service.cancelQueued(thread.id, first);
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'accept' });
  await until(() => thread.state === 'completed');
  expect(thread.messages.filter((row) => row.kind === 'user')).toHaveLength(1);
  service.controlQueue(thread.id, false);
  await until(() => service.queueState(thread.id).items.length === 0);
  expect(thread.messages.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([
    '[approve] Editing fixture',
    'Edited queued message',
  ]);
});
it('holds remaining queued messages after stopping a task until explicitly resumed', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Stop queue fixture', thread.settings);
  await until(() => thread.actions.length > 0);
  await service.enqueue(thread.id, randomUUID(), {
    text: 'After deliberate resume',
    settings: thread.settings,
    attachments: [],
  });
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.queueState(thread.id)).toMatchObject({ paused: true });
  expect(thread.messages.filter((row) => row.kind === 'user')).toHaveLength(1);
  const interruptedTurn = thread.turnId;
  service.controlQueue(thread.id, false);
  service.driver.emit('notification', {
    method: 'turn/completed',
    params: { threadId: thread.id, turn: { id: interruptedTurn, status: 'interrupted' } },
  });
  await until(() => service.queueState(thread.id).items.length === 0);
  expect(thread.messages.filter((row) => row.kind === 'user')).toHaveLength(2);
});
it('lets new queued work run after an interruption with no waiting followers', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Stop without followers', thread.settings);
  await until(() => thread.actions.length > 0);
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  expect(service.queueState(thread.id).paused).toBe(false);
  const id = randomUUID();
  await service.enqueue(thread.id, id, {
    text: 'New work',
    settings: thread.settings,
    attachments: [],
  });
  await until(() => service.store.queue.get(id)?.state === 'completed');
  expect(thread.messages.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([
    '[approve] Stop without followers',
    'New work',
  ]);
});
it('protects an uncertain queued dispatch and reconciles it without resending', async () => {
  const { service, thread } = await fixture(1400);
  const first = randomUUID();
  await service.enqueue(thread.id, first, {
    text: '[lost-ack] [lost-terminal] Queue uncertainty',
    settings: thread.settings,
    attachments: [],
  });
  await until(() => service.store.queue.get(first)?.state === 'unknown');
  await service.enqueue(thread.id, randomUUID(), {
    text: 'After checking the result',
    settings: thread.settings,
    attachments: [],
  });
  expect(() => service.controlQueue(thread.id, false)).toThrow(/Check unknown results/);
  await service.reconcile(thread.id);
  expect(service.store.queue.get(first)?.state).toBe('completed');
  expect(service.queueState(thread.id).paused).toBe(true);
  service.controlQueue(thread.id, false);
  await until(() => service.queueState(thread.id).items.length === 0);
  expect(thread.messages.filter((row) => row.kind === 'user')).toHaveLength(2);
});
it('revalidates queued file context at dispatch and holds later messages on failure', async () => {
  const { service, project, thread, directory } = await fixture();
  await writeFile(join(directory, 'queued.txt'), 'before\n');
  const file = await service.file(project.id, 'queued.txt');
  await service.send(thread.id, randomUUID(), '[approve] Context fixture', thread.settings);
  await until(() => thread.actions.length > 0);
  const id = randomUUID();
  await service.enqueue(thread.id, id, {
    text: 'Read queued context',
    settings: thread.settings,
    attachments: [{ path: file.path, sha: file.sha, fromLine: 1, toLine: 1 }],
  });
  await service.enqueue(thread.id, randomUUID(), {
    text: 'Must remain waiting',
    settings: thread.settings,
    attachments: [],
  });
  await writeFile(join(directory, 'queued.txt'), 'changed\n');
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'accept' });
  await until(() => service.store.queue.get(id)?.state === 'failed');
  expect(service.queueState(thread.id)).toMatchObject({ paused: true });
  expect(thread.messages.filter((row) => row.kind === 'user')).toHaveLength(1);
});
it('keeps stale project references editable in the queue and dispatches only after review', async () => {
  const { service } = await fixture();
  const workspace = await mkdtemp(join(tmpdir(), 'codes-reference-queue-'));
  cleanup.push(() => rm(workspace, { recursive: true, force: true }));
  const project = await service.addProject(workspace);
  const thread = await service.create(project.id);
  await writeFile(
    join(workspace, 'build.log'),
    'keep this content out of the prompt\n'.repeat(20_000),
  );
  const reference = await service.fileManagement.reference(project.id, 'build.log', false);
  const native = vi.spyOn(service.driver, 'call');
  await service.send(
    thread.id,
    randomUUID(),
    '[approve] Read the referenced file',
    thread.settings,
    [reference],
  );
  const started = native.mock.calls.find(([method]) => method === 'turn/start');
  expect(JSON.stringify(started?.[1])).toContain('build.log');
  expect(JSON.stringify(started?.[1])).not.toContain('keep this content out of the prompt');
  await until(() => thread.actions.length > 0);
  const queued = randomUUID();
  await service.enqueue(thread.id, queued, {
    text: 'Process the file',
    settings: thread.settings,
    attachments: [reference],
  });
  await writeFile(join(workspace, 'build.log'), 'A different version');
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'accept' });
  await until(() => service.queueState(thread.id).paused);
  expect(service.store.queue.get(queued)).toMatchObject({
    state: 'queued',
    error: expect.stringContaining('referenced file changed'),
  });
  expect(service.store.operation(queued)).toBeUndefined();
  service.editQueued(thread.id, queued, 'Continue without the file', true);
  expect(service.store.queue.get(queued)).toMatchObject({ state: 'queued', attachments: [] });
  service.controlQueue(thread.id, false);
  await until(() => service.store.operation(queued)?.state === 'completed');
});

it('bounds the per-conversation queue and does not bypass waiting messages with direct sends', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Capacity fixture', thread.settings);
  await until(() => thread.actions.length > 0);
  for (let i = 0; i < 10; i++)
    await service.enqueue(thread.id, randomUUID(), {
      text: 'Waiting ' + i,
      settings: thread.settings,
      attachments: [],
    });
  await expect(
    service.enqueue(thread.id, randomUUID(), {
      text: 'Overflow',
      settings: thread.settings,
      attachments: [],
    }),
  ).rejects.toMatchObject({ code: 'QUEUE_LIMIT' });
  await expect(
    service.send(thread.id, randomUUID(), 'Bypass', thread.settings),
  ).rejects.toMatchObject({ code: 'QUEUE_PENDING' });
  await service.interrupt(thread.id);
});
it('forks through an exact completed turn without changing the source history or copying its queue', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'First source turn', thread.settings);
  await until(() => thread.state === 'completed');
  const anchor = thread.messages.find((row) => row.kind === 'assistant')!.turnId;
  await service.send(thread.id, randomUUID(), 'Second source turn', thread.settings);
  await until(() => thread.state === 'completed');
  const op = randomUUID();
  const child = await service.fork(thread.id, op, anchor);
  expect(child).toMatchObject({ forkedFromId: thread.id, queueCount: 0 });
  expect((await service.fork(thread.id, op, anchor)).id).toBe(child.id);
  await expect(service.fork(thread.id, op, 'different')).rejects.toMatchObject({
    code: 'OPERATION_CONFLICT',
  });
  const branch = await service.read(child.id);
  expect(branch.settings.permission).toBeUndefined();
  expect((await service.source(child.id)).id).toBe(thread.id);
  expect(branch.messages.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([
    'First source turn',
  ]);
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(2);
  await service.send(child.id, randomUUID(), 'Branch continuation', branch.settings);
  await until(() => branch.state === 'completed');
  expect(
    (await service.history(thread.id)).messages.filter((row) => row.kind === 'user'),
  ).toHaveLength(2);
});
it('refuses a branch through an unfinished or unknown native turn', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Incomplete fork', thread.settings);
  await until(() => thread.actions.length > 0);
  await expect(service.fork(thread.id, randomUUID(), thread.turnId!)).rejects.toMatchObject({
    code: 'CLI_ERROR',
  });
  await expect(service.fork(thread.id, randomUUID(), 'other-turn')).rejects.toMatchObject({
    code: 'CLI_ERROR',
  });
  await service.interrupt(thread.id);
});

it('preserves structured question headers and refuses custom answers when native options are closed', async () => {
  const { service, thread } = await fixture();
  await service.send(
    thread.id,
    randomUUID(),
    '[question] [no-other] Closed choice fixture',
    thread.settings,
  );
  await until(() => thread.actions.length > 0);
  const action = thread.actions[0]!;
  expect(action.questions?.[0]).toMatchObject({ header: 'Direction', allowOther: false });
  await expect(
    service.answer(action.id, randomUUID(), { answers: { direction: 'Not an option' } }),
  ).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
  await expect(
    service.answer(action.id, randomUUID(), {
      answers: { direction: 'Continue', other: 'Wrong question' },
    }),
  ).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
  await service.answer(action.id, randomUUID(), { answers: { direction: 'Continue' } });
  await until(() => thread.state === 'completed');
});
it('bounds queue event previews without clipping the stored or dispatched message', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[approve] Preview fixture', thread.settings);
  await until(() => thread.actions.length > 0);
  const text = 'A long queued prompt ' + 'x'.repeat(20_000);
  const id = randomUUID();
  await service.enqueue(thread.id, id, { text, settings: thread.settings, attachments: [] });
  expect(service.queueState(thread.id).items[0]).toMatchObject({ textTruncated: true });
  expect(service.queueState(thread.id).items[0]!.text.length).toBe(2000);
  expect(service.store.queue.get(id)?.text).toBe(text);
  await service.answer(thread.actions[0]!.id, randomUUID(), { decision: 'accept' });
  await until(() => service.queueState(thread.id).items.length === 0);
  expect(thread.messages.filter((row) => row.kind === 'user').at(-1)?.text).toBe(text);
});

it('discovers a native branch source beyond the current page and preserves its archive state', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', { cwd: project.path, count: 2 });
  const parentId = seeded.thread.id;
  const forked = await service.driver.call('thread/fork', {
    threadId: parentId,
    lastTurnId: 'turn-0',
    excludeTurns: true,
  });
  await service.driver.call('thread/archive', { threadId: parentId });
  await service.conversations(project.id, { limit: 1 });
  expect(service.store.thread(forked.thread.id)).toBeTruthy();
  expect(service.store.thread(parentId)).toBeUndefined();
  expect(await service.source(forked.thread.id)).toMatchObject({ id: parentId, archived: true });
});

it('holds additional conversation queues when all four native execution slots are occupied', async () => {
  const { service, project, thread } = await fixture();
  const conversations = [thread];
  for (let i = 0; i < 4; i++) conversations.push(await service.create(project.id, thread.settings));
  const ids = conversations.map(() => randomUUID());
  for (let i = 0; i < conversations.length; i++)
    await service.enqueue(conversations[i]!.id, ids[i]!, {
      text: '[approve] Concurrent queue ' + i,
      settings: thread.settings,
      attachments: [],
    });
  await until(
    () =>
      service.store.activeCount() === 4 &&
      conversations.filter((row) => row.actions.length > 0).length === 4,
  );
  expect(service.store.queue.get(ids[4]!)?.state).toBe('queued');
  await service.interrupt(conversations[0]!.id);
  await until(() => conversations[4]!.actions.length > 0);
  expect(service.store.activeCount()).toBeLessThanOrEqual(4);
  expect(service.store.queue.get(ids[4]!)?.state).not.toBe('failed');
});

it('observes native sidebar status without treating idle or unloaded as a terminal receipt', async () => {
  const { service, thread } = await fixture();
  const notify = (status: unknown) =>
    service.driver.emit('notification', {
      method: 'thread/status/changed',
      params: { threadId: thread.id, status },
    });
  const updatedAt = service.store.thread(thread.id)!.updatedAt;
  notify({ type: 'active', activeFlags: ['waitingOnApproval'] });
  expect(service.store.thread(thread.id)?.state).toBe('waitingApproval');
  notify({ type: 'active', activeFlags: ['waitingOnUserInput'] });
  expect(service.store.thread(thread.id)?.state).toBe('waitingInput');
  notify({ type: 'idle' });
  expect(service.store.thread(thread.id)?.state).toBe('idle');
  expect(service.store.thread(thread.id)?.updatedAt).toBe(updatedAt);
  notify({ type: 'active', activeFlags: 'malformed' });
  expect(service.store.thread(thread.id)?.state).toBe('idle');
  await service.send(thread.id, randomUUID(), '[hold] Sidebar status fixture', thread.settings);
  notify({ type: 'idle' });
  expect(service.store.thread(thread.id)).toMatchObject({
    state: 'running',
    executionPending: true,
  });
  await service.interrupt(thread.id);
  await until(() => thread.state === 'interrupted');
  notify({ type: 'notLoaded' });
  expect(service.store.thread(thread.id)?.state).toBe('interrupted');
  notify({ type: 'idle' });
  expect(service.store.thread(thread.id)?.state).toBe('interrupted');
  service.store.begin('uncertain', thread.id, 'send', {});
  service.store.update('uncertain', 'unknown');
  notify({ type: 'active', activeFlags: [] });
  expect(service.store.thread(thread.id)).toMatchObject({
    state: 'interrupted',
    executionUnknown: true,
  });
});

it('does not let delayed native list status overwrite a newer completion event', async () => {
  const { service, project, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  let captured!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const value = await call(method, params, timeout);
    if (method === 'thread/list') {
      for (const entry of value.data)
        if (entry.id === thread.id) entry.status = { type: 'active', activeFlags: [] };
      captured();
      await held;
    }
    return value;
  });
  const listing = service.conversations(project.id);
  await started;
  await service.send(thread.id, randomUUID(), 'Finish while listing', thread.settings);
  await until(() => thread.state === 'completed');
  release();
  const result = await listing;
  expect(result.data.find((row) => row.id === thread.id)?.state).toBe('completed');
  expect(service.store.thread(thread.id)?.state).toBe('completed');
});

it('retains history-established imported outcomes through list refresh without clearing unknown receipts', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', { cwd: project.path, count: 2 });
  await service.conversations(project.id);
  const thread = await service.read(seeded.thread.id);
  expect(thread.state).toBe('completed');
  expect(service.store.thread(thread.id)?.state).toBe('completed');
  expect(
    (await service.conversations(project.id)).data.find((row) => row.id === thread.id)?.state,
  ).toBe('completed');
  const next = await service.driver.call('test/seed', { cwd: project.path, count: 2 });
  await service.conversations(project.id);
  service.store.begin('unknown-imported-task', next.thread.id, 'send', {});
  service.store.update('unknown-imported-task', 'unknown');
  expect((await service.read(next.thread.id)).state).toBe('unknown');
  expect(service.store.thread(next.thread.id)).toMatchObject({
    state: 'unknown',
    executionUnknown: true,
  });
  expect(
    (await service.conversations(project.id)).data.find((row) => row.id === next.thread.id)?.state,
  ).toBe('unknown');
});

it('maps image-only sends to native localImage, preserves history references and keeps a usable title', async () => {
  const { imagePng } = await import('./fixtures/image');
  const { service, thread, project } = await fixture();
  const image = await service.images.save(project.id, imagePng, 'screenshot.png', 'image/png');
  const spy = vi.spyOn(service.driver, 'call');
  await service.send(thread.id, randomUUID(), '', thread.settings, [image]);
  await until(() => thread.state === 'completed');
  const input = (spy.mock.calls.find(([method]) => method === 'turn/start')![1] as any).input;
  expect(input).toEqual([
    { type: 'localImage', path: (await service.images.read(project.id, image.id)).path },
  ]);
  const history = await service.history(thread.id);
  expect(history.messages.find((row) => row.kind === 'user')?.images?.[0]?.id).toBe(image.id);
  expect(thread.title).toBe('screenshot.png');
  expect(
    (await service.conversations(project.id)).data.find((row) => row.id === thread.id)?.title,
  ).toBe('screenshot.png');
  expect(JSON.stringify(history)).not.toContain('data:image');
  expect(JSON.stringify(history)).not.toContain(service.store.directory);
});

it('retains image attachments through immediate steering and durable queued dispatch', async () => {
  const { imagePng } = await import('./fixtures/image');
  const { service, thread, project } = await fixture();
  const image = await service.images.save(project.id, imagePng, 'queued.png', 'image/png');
  const spy = vi.spyOn(service.driver, 'call');
  await service.send(thread.id, randomUUID(), '[hold] Image follow-up fixture', thread.settings);
  await service.steer(thread.id, randomUUID(), thread.turnId!, '', [image]);
  const steering = (spy.mock.calls.find(([method]) => method === 'turn/steer')![1] as any).input;
  expect(steering[0]).toMatchObject({ type: 'localImage' });
  const queued = randomUUID();
  await service.enqueue(thread.id, queued, {
    text: '',
    attachments: [image],
    settings: thread.settings,
  });
  expect(service.store.queue.get(queued)?.attachments).toEqual([image]);
  await service.interrupt(thread.id);
  service.controlQueue(thread.id, false);
  await until(() => service.store.queue.get(queued)?.state === 'completed');
  const last = (spy.mock.calls.filter(([method]) => method === 'turn/start').at(-1)![1] as any)
    .input;
  expect(last).toEqual(steering);
  expect(thread.messages.filter((row) => row.kind === 'user' && row.images?.length)).toHaveLength(
    2,
  );
});

it('rejects image-incapable models before native task execution', async () => {
  const { imagePng } = await import('./fixtures/image');
  const { service, thread, project } = await fixture();
  const image = await service.images.save(project.id, imagePng, 'capture.png', 'image/png');
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const response = await call(method, params, timeout);
      if (method === 'model/list') response.data[0].inputModalities = ['text'];
      return response;
    });
  await expect(
    service.send(thread.id, randomUUID(), '', thread.settings, [image]),
  ).rejects.toMatchObject({ code: 'IMAGES_UNAVAILABLE' });
  expect(spy.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(0);
});

it('reads legacy full turn pages in both directions without item pagination or eager thread reads', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', { cwd: project.path, count: 40 });
  await service.list(project.id);
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      if (method === 'thread/read') expect(params).toMatchObject({ includeTurns: false });
      const result = await call(method, params, timeout);
      if (method === 'thread/read') result.thread.historyMode = 'legacy';
      if (method === 'thread/turns/list') {
        expect(params).toMatchObject({ itemsView: 'full', limit: 1 });
        for (const turn of result.data) {
          turn.itemsView = 'full';
          turn.items = [
            {
              type: 'userMessage',
              id: turn.id + '-user',
              content: [{ type: 'text', text: 'Legacy question' }],
            },
            {
              type: 'agentMessage',
              id: turn.id + '-answer',
              text: 'Legacy answer ' + turn.id,
              phase: 'final_answer',
            },
          ];
        }
      }
      return result;
    });
  const latest = await service.history(seeded.thread.id);
  expect(latest.messages.map((row) => row.kind)).toEqual(['user', 'assistant']);
  expect(latest.messages.at(-1)?.text).toContain('Legacy answer');
  expect(latest.olderCursor).toBeTruthy();
  const earlier = await service.history(seeded.thread.id, latest.olderCursor!);
  expect(earlier.turns[0]?.id).not.toBe(latest.turns[0]?.id);
  const forward = await service.history(seeded.thread.id, earlier.newerCursor!);
  expect(forward.turns.at(-1)?.id).toBe(earlier.turns.at(-1)?.id);
  const caughtUp = await service.history(seeded.thread.id, forward.newerCursor!);
  expect(caughtUp.turns.at(-1)?.id).toBe(latest.turns.at(-1)?.id);
  expect(spy.mock.calls.some(([method]) => method === 'thread/items/list')).toBe(false);
});
it('retains the display budget for oversized legacy turns instead of silently dropping items', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await call(method, params, timeout);
    if (method === 'thread/read') result.thread.historyMode = 'legacy';
    if (method === 'thread/turns/list')
      result.data = [
        {
          id: 'legacy-large',
          status: 'completed',
          itemsView: 'full',
          items: Array.from({ length: 241 }, (_, n) => ({
            type: 'agentMessage',
            id: 'message-' + n,
            text: 'Legacy content ' + n,
          })),
        },
      ];
    return result;
  });
  await expect(service.history(thread.id)).rejects.toMatchObject({
    code: 'HISTORY_LIMIT',
    status: 413,
  });
});
it('rejects malformed full legacy items without treating them as an empty transcript', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await call(method, params, timeout);
    if (method === 'thread/read') result.thread.historyMode = 'legacy';
    if (method === 'thread/turns/list')
      result.data = [{ id: 'legacy-invalid', status: 'completed', itemsView: 'full', items: null }];
    return result;
  });
  await expect(service.history(thread.id)).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
});
it('preserves genuinely empty legacy history without requesting unsupported item pages', async () => {
  const { service, thread } = await fixture();
  const call = service.driver.call.bind(service.driver);
  const spy = vi
    .spyOn(service.driver, 'call')
    .mockImplementation(async (method, params, timeout) => {
      const result = await call(method, params, timeout);
      if (method === 'thread/read') result.thread.historyMode = 'legacy';
      return result;
    });
  expect((await service.history(thread.id)).messages).toEqual([]);
  expect(spy.mock.calls.some(([method]) => method === 'thread/items/list')).toBe(false);
});

it('retains history and task status when an imported conversation belongs to another native writer', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 2,
    foreignWriter: true,
  });
  await service.list(project.id);
  const thread = await service.read(seeded.thread.id);
  const messages = structuredClone(thread.messages);
  const operation = randomUUID();
  await expect(
    service.send(thread.id, operation, 'Keep this draft', thread.settings),
  ).rejects.toMatchObject({ code: 'THREAD_WRITER_BUSY', uncertain: false });
  expect(thread.writerConflict).toBe(true);
  expect(thread.state).toBe('completed');
  expect(thread.pending).toBeUndefined();
  expect(thread.messages).toEqual(messages);
  expect(service.store.operation(operation)?.state).toBe('failed');
  expect(service.store.active(thread.id)).toBeUndefined();
  await expect(service.retryWriter(thread.id)).rejects.toMatchObject({
    code: 'THREAD_WRITER_BUSY',
  });
  const point = await service.branchPoint(thread.id);
  const branch = await service.fork(thread.id, randomUUID(), point.lastTurnId);
  expect(branch.id).not.toBe(thread.id);
  expect(branch.forkedFromId).toBe(thread.id);
  expect((await service.history(thread.id)).messages).toEqual(messages);
  expect((await service.read(branch.id)).settings.permission).toBeUndefined();
});
it('checks a released writer without sending the rejected task automatically', async () => {
  const { service, project } = await fixture();
  const seeded = await service.driver.call('test/seed', {
    cwd: project.path,
    count: 1,
    foreignWriter: true,
    releaseWriterOnRetry: true,
  });
  await service.list(project.id);
  const thread = await service.read(seeded.thread.id);
  await expect(
    service.send(thread.id, randomUUID(), 'Do not replay', thread.settings),
  ).rejects.toMatchObject({ code: 'THREAD_WRITER_BUSY' });
  const restored = await service.retryWriter(thread.id);
  expect(restored.writerConflict).toBe(false);
  expect(restored.messages.filter((entry) => entry.kind === 'user')).toHaveLength(0);
  expect(service.store.active(thread.id)).toBeUndefined();
  await service.send(thread.id, randomUUID(), 'Explicit new task', thread.settings);
  await until(() => thread.state === 'completed');
  expect(thread.messages.filter((entry) => entry.kind === 'user')).toHaveLength(1);
});
it('never selects a running turn as the ownership-recovery branch point', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), 'First finished turn', thread.settings);
  await until(() => thread.state === 'completed');
  const first = thread.turnId;
  await service.send(thread.id, randomUUID(), '[hold] Active turn', thread.settings);
  expect(await service.branchPoint(thread.id)).toEqual({ lastTurnId: first });
  await expect(service.retryWriter(thread.id)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
});

it('drains existing tasks during maintenance and resumes queued work only when canceled', async () => {
  const { service, thread } = await fixture();
  const settings = { ...thread.settings, mode: 'plan' as const };
  const first = randomUUID();
  await service.send(thread.id, first, '[question]', settings);
  await until(() => thread.state === 'waitingInput');
  const queued = randomUUID();
  await service.enqueue(thread.id, queued, {
    text: 'Queued before maintenance',
    settings,
    attachments: [],
  });

  expect(service.startMaintenance().maintenance?.ready).toBe(false);
  expect(() => service.startMaintenance()).toThrow(/already active/);
  await expect(service.send(thread.id, randomUUID(), 'New work', settings)).rejects.toMatchObject({
    code: 'MAINTENANCE_ACTIVE',
  });
  await expect(
    service.enqueue(thread.id, randomUUID(), {
      text: 'New queued work',
      settings,
      attachments: [],
    }),
  ).rejects.toMatchObject({ code: 'MAINTENANCE_ACTIVE' });
  await service.answer(thread.actions[0]!.id, randomUUID(), { answers: { direction: 'Continue' } });
  await until(() => service.system().maintenance?.ready === true);
  expect(service.store.operation(first)?.state).toBe('completed');
  expect(service.store.operation(queued)).toBeUndefined();
  expect(service.store.queue.get(queued)?.state).toBe('queued');

  expect(service.cancelMaintenance().maintenance).toBeUndefined();
  await until(() => service.store.operation(queued)?.state === 'completed');
});

it('reports turn usage from native cumulative counters without counting duplicate events', async () => {
  const { service, thread } = await fixture();
  await service.send(thread.id, randomUUID(), '[hold] Usage fixture', thread.settings);
  await until(() => thread.usage?.turnOutputTokens === 120);
  const turnId = thread.turnId;
  const report = (eventTurn: string | undefined, totalTokens: number, outputTokens: number) =>
    service.driver.emit('notification', {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: thread.id,
        turnId: eventTurn,
        tokenUsage: {
          last: { totalTokens: 100, outputTokens: 20 },
          total: { totalTokens, outputTokens },
        },
      },
    });
  report(turnId, 3500, 360);
  report(turnId, 3500, 360);
  report('old-turn', 9500, 960);
  report(turnId, 3400, 340);
  expect(thread.usage).toMatchObject({
    turnId,
    totalTokens: 3500,
    turnTotalTokens: 1300,
    turnOutputTokens: 140,
  });
});

it('publishes both pending interactions and the response phase in sidebar summaries', async () => {
  const { service, thread, project } = await fixture();
  const published = vi.spyOn(service.events, 'publish');
  await service.send(thread.id, randomUUID(), '[question]', { ...thread.settings, mode: 'plan' });
  await until(() => thread.state === 'waitingInput');
  expect(service.summaries(project.id)).toContainEqual(
    expect.objectContaining({ id: thread.id, sidebarActivity: 'needsInput' }),
  );

  service.driver.emit('request', {
    id: 900100,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: thread.id, turnId: thread.turnId, command: 'synthetic approval' },
  });
  expect(published).toHaveBeenCalledWith(
    'summary',
    expect.objectContaining({ sidebarActivity: 'approvalAndInput' }),
    thread.id,
  );
  await service.answer(thread.actions.find((a) => a.kind === 'questions')!.id, randomUUID(), {
    answers: { direction: 'Continue' },
  });
  expect(published).toHaveBeenCalledWith(
    'summary',
    expect.objectContaining({ sidebarActivity: 'needsApproval' }),
    thread.id,
  );
  await until(() => thread.state === 'completed');

  await service.send(thread.id, randomUUID(), '[question]', { ...thread.settings, mode: 'plan' });
  await until(() => thread.state === 'waitingInput');
  await service.answer(thread.actions.find((a) => a.status === 'pending')!.id, randomUUID(), {
    answers: { direction: 'Continue' },
  });
  expect(published).toHaveBeenCalledWith(
    'summary',
    expect.objectContaining({ sidebarActivity: 'responding' }),
    thread.id,
  );
});

it('restores usage for the original completed turn after another turn and a service restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codes-turn-usage-'));
  const open = () =>
    new Service(
      new Store(directory),
      new Driver('mock', { stateFile: join(directory, 'history.json') }),
    );
  let service = open();
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await service.addProject(directory, 'Usage fixture');
  const thread = await service.create(project.id, { permission: 'read-only' });
  const first = await service.send(thread.id, randomUUID(), 'First measured turn', thread.settings);
  await until(() => thread.state === 'completed');
  const turnId = first.turnId!;
  expect(thread.turns?.find((turn) => turn.id === turnId)?.usage).toEqual({
    totalTokens: 1200,
    outputTokens: 120,
  });
  await service.send(thread.id, randomUUID(), 'Second measured turn', thread.settings);
  await until(() => thread.state === 'completed' && thread.turnId !== turnId);
  await service.close();
  service = open();
  const { turns } = await service.history(thread.id);
  expect(turns.find((turn) => turn.id === turnId)?.usage).toEqual({
    totalTokens: 1200,
    outputTokens: 120,
  });
});

it('discovers native sessions across directories and preserves Codex archive membership', async () => {
  const { service, directory } = await fixture();
  const cwd = join(directory, 'unregistered');
  await mkdir(cwd);
  const imported = await service.driver.call('test/seed', { cwd, count: 2 });
  const id = imported.thread.id;
  expect(service.store.projects().some((project) => project.path === cwd)).toBe(false);

  const list = await service.nativeConversations({ search: 'rendering reference' });
  expect(list.data).toEqual([
    expect.objectContaining({ id, cwd, title: 'Rendering reference', archived: false }),
  ]);
  expect(
    (await service.nativeConversations({ cwd: directory })).data.every((row) => row.id !== id),
  ).toBe(true);
  expect((await service.read(id)).id).toBe(id);
  expect(service.project((await service.read(id)).projectId).path).toBe(cwd);

  await service.archive(id, randomUUID(), true);
  expect((await service.nativeConversations({ cwd })).data).toEqual([]);
  expect((await service.nativeConversations({ cwd, archived: true })).data).toEqual([
    expect.objectContaining({ id, cwd, archived: true }),
  ]);
  await service.archive(id, randomUUID(), false);
  expect((await service.nativeConversations({ cwd })).data[0]?.id).toBe(id);
});

it('loads a native deep link before listing and keeps history with a missing working directory', async () => {
  const { service, directory } = await fixture();
  const cwd = join(directory, 'missing');
  const imported = await service.driver.call('test/seed', { cwd, count: 2 });
  const id = imported.thread.id;
  await service.driver.call('thread/archive', { threadId: id });
  expect(service.store.thread(id)).toBeUndefined();
  const thread = await service.read(id);
  expect(thread).toMatchObject({ id, archived: true, state: 'completed' });
  expect(thread.messages.length).toBeGreaterThan(0);
  expect(await service.conversationContext(id)).toMatchObject({
    project: { path: cwd },
    directory: { available: false, code: 'DIRECTORY_UNAVAILABLE' },
  });
});

it('matches the CLI picker search fields and limits Repo to linked worktrees', async () => {
  const { service, directory, thread } = await fixture();
  const linked = join(directory, 'linked-checkout');
  const unrelated = join(directory, 'unrelated');
  await mkdir(unrelated);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
  git('init', '-q');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'Fixture',
  );
  git('worktree', 'add', '-qb', 'fixture-worktree', linked);
  const external = await service.driver.call('test/seed', { cwd: linked, count: 2 });
  await service.driver.call('test/seed', { cwd: unrelated, count: 2 });
  const nativeCall = service.driver.call.bind(service.driver);
  vi.spyOn(service.driver, 'call').mockImplementation(async (method, params, timeout) => {
    const result = await nativeCall(method, params, timeout);
    if (method === 'thread/list') {
      const row = result.data.find((entry: { id: string }) => entry.id === external.thread.id);
      if (row) row.gitInfo = { branch: 'fixture-worktree' };
    }
    return result;
  });
  expect(await service.nativeConversationRepository(directory)).toEqual([directory, linked].sort());
  const repository = await service.nativeConversations({ cwd: directory, repo: true });
  expect(repository.data.map((row) => row.id).sort()).toEqual(
    [thread.id, external.thread.id].sort(),
  );
  for (const search of [
    'FIXTURE-WORKTREE',
    'Synthetic history',
    'linked-checkout',
    external.thread.id.slice(0, 12),
  ]) {
    const result = await service.nativeConversations({ cwd: directory, repo: true, search });
    expect(result.data).toEqual([
      expect.objectContaining({
        id: external.thread.id,
        cwd: linked,
        gitBranch: 'fixture-worktree',
      }),
    ]);
  }
  expect((await service.nativeConversations({ cwd: directory })).data.map((row) => row.id)).toEqual(
    [thread.id],
  );
});
