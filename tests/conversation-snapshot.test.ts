import { afterEach, expect, it, vi } from 'vitest';
import { ConversationSnapshot } from '../src/web/conversation-snapshot';
import { limits, type Envelope } from '../src/shared/types';

const epoch = 'workspace-epoch';
const id = 'conversation-a';
const event = (seq: number): Envelope => ({
  epoch,
  seq,
  threadId: id,
  kind: 'text',
  data: { id: 'message', delta: 'text' },
});
function snapshotResponse(seq: number) {
  return Response.json({ thread: { id }, cursor: { epoch, seq } });
}
function fixture() {
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const applied = vi.fn();
  const status = vi.fn();
  const snapshot = new ConversationSnapshot(id, () => applied('snapshot'), applied, status);
  snapshot.prepare(epoch);
  return { applied, status, snapshot, respond: (seq: number) => respond(snapshotResponse(seq)) };
}
afterEach(() => vi.unstubAllGlobals());

it('applies only events newer than the loaded conversation while the web stream stays open', async () => {
  const { snapshot, applied, status, respond } = fixture();
  const loading = snapshot.refresh();
  snapshot.receive(event(4));
  snapshot.receive(event(6));
  expect(applied).not.toHaveBeenCalled();
  respond(5);
  await loading;
  snapshot.receive(event(7));
  expect(applied.mock.calls).toEqual([['snapshot'], [event(6)], [event(7)]]);
  expect(status).toHaveBeenLastCalledWith('Connected');
});

it('rejects a cursor too old to replay a bounded buffer', async () => {
  const { snapshot, applied, status, respond } = fixture();
  const loading = snapshot.refresh();
  for (let seq = 1; seq <= limits.events + 1; seq++) snapshot.receive(event(seq));
  respond(0);
  await loading;
  expect(applied).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith(
    'Unavailable',
    expect.objectContaining({ code: 'SNAPSHOT_STALE' }),
  );
});
