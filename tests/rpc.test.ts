import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Rpc, nativeFrameBytes } from '../src/codex/rpc';

function fixture(timeout = 1000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const rpc = new Rpc(input, output, timeout);
  const sent: any[] = [];
  input.on('data', (b) => sent.push(JSON.parse(String(b))));
  return { rpc, input, output, sent };
}
describe('CLI JSONL transport', () => {
  it('decodes fragmented UTF-8 and multiple envelopes without losing text', async () => {
    const { rpc, output, sent } = fixture();
    const result = rpc.request('hello', {});
    const bytes = Buffer.from(
      JSON.stringify({ id: sent[0].id, result: { text: '代码🙂' } }) + '\n',
    );
    for (const byte of bytes) output.write(Buffer.from([byte]));
    await expect(result).resolves.toEqual({ text: '代码🙂' });
    rpc.fail();
  });
  it('routes server requests separately from notifications', () => {
    const { rpc, output } = fixture();
    const values: string[] = [];
    rpc.on('request', () => values.push('request'));
    rpc.on('notification', () => values.push('notification'));
    output.write('{"id":7,"method":"approval","params":{}}\n{"method":"delta","params":{}}\n');
    expect(values).toEqual(['request', 'notification']);
    rpc.fail();
  });
  it('marks a lost acknowledgement uncertain and never resends', async () => {
    const { rpc, output, sent } = fixture(25);
    const result = rpc.request('turn/start', {});
    await expect(result).rejects.toMatchObject({
      code: 'RESULT_UNKNOWN',
      uncertain: true,
      message: expect.stringContaining('turn/start'),
    });
    output.write('{"id":1,"result":{"late":true}}\n');
    expect(sent).toHaveLength(1);
    rpc.fail();
  });
  it('fails outstanding requests on malformed JSON and remains failed', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('hello', {});
    output.write('not json\n');
    await expect(pending).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    await expect(rpc.request('hello', {})).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('reads a fragmented multi-megabyte native result and keeps later envelopes usable', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('thread/items/list', {});
    const text = '界'.repeat(2 * 1024 * 1024);
    const bytes = Buffer.from(JSON.stringify({ id: 1, result: { text } }) + '\n');
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
      output.write(bytes.subarray(offset, offset + 64 * 1024));
    expect((await pending).text.length).toBe(text.length);
    const next = rpc.request('hello', {});
    output.write('{"id":2,"result":{"ok":true}}\n');
    await expect(next).resolves.toEqual({ ok: true });
    rpc.fail();
  });
  it('rejects oversized frames', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('hello', {});
    output.write(Buffer.alloc(nativeFrameBytes + 1, 65));
    await expect(pending).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('discards an identified oversized history response while retaining a concurrent task receipt', async () => {
    const { rpc, output } = fixture();
    const history = rpc.request('thread/items/list', {});
    const start = rpc.request('turn/start', {});
    const historyError = expect(history).rejects.toMatchObject({
      code: 'HISTORY_LIMIT',
      uncertain: false,
    });
    output.write('{"id":');
    output.write('1,"result":{"text":"');
    const chunk = Buffer.alloc(64 * 1024, 65);
    for (let offset = 0; offset <= nativeFrameBytes; offset += chunk.length) output.write(chunk);
    output.write('"}}\n{"id":2,"result":{"turn":{"id":"running"}}}\n');
    await historyError;
    await expect(start).resolves.toEqual({ turn: { id: 'running' } });
    rpc.fail();
  });
  it('distinguishes a definite CLI rejection from a lost result', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('turn/start', {});
    output.write('{"id":1,"error":{"message":"Already active"}}\n');
    await expect(pending).rejects.toMatchObject({ code: 'CLI_ERROR', uncertain: false });
    rpc.fail();
  });
});

it('reports an explicit native writer conflict as retryable ownership contention without resending', async () => {
  const { rpc, output, sent } = fixture();
  const pending = rpc.request('thread/resume', {
    threadId: '00000000-0000-0000-0000-000000000001',
  });
  output.write(
    JSON.stringify({
      id: sent[0].id,
      error: {
        code: -32600,
        message: 'thread 00000000-0000-0000-0000-000000000001 already has an active writer',
      },
    }) + '\n',
  );
  await expect(pending).rejects.toMatchObject({
    code: 'THREAD_WRITER_BUSY',
    status: 409,
    uncertain: false,
  });
  expect(sent).toHaveLength(1);
  rpc.fail();
});
