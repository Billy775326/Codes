import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Rpc } from '../src/codex/rpc';

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
    await expect(result).rejects.toMatchObject({ code: 'RESULT_UNKNOWN', uncertain: true });
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
  it('rejects oversized frames', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('hello', {});
    output.write(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
    await expect(pending).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it('distinguishes a definite CLI rejection from a lost result', async () => {
    const { rpc, output } = fixture();
    const pending = rpc.request('turn/start', {});
    output.write('{"id":1,"error":{"message":"Already active"}}\n');
    await expect(pending).rejects.toMatchObject({ code: 'CLI_ERROR', uncertain: false });
    rpc.fail();
  });
});
