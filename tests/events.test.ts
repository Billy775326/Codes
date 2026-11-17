import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { expect, it } from 'vitest';
import { Events } from '../src/server/events';
class Response extends EventEmitter {
  content = '';
  destroyed = false;
  writableLength = 0;
  write(value: string) {
    this.content += value;
  }
  end() {
    this.emit('close');
  }
  destroy() {
    this.destroyed = true;
    this.end();
  }
}
it('replays missed thread events and summaries without leaking other thread content', () => {
  const events = new Events();
  events.publish('text', { delta: 'other-secret' }, 'b');
  events.publish('summary', { title: 'Other' }, 'b');
  events.publish('text', { delta: 'mine' }, 'a');
  const response = new Response();
  events.subscribe('a', 0, events.epoch, response as unknown as ServerResponse);
  expect(response.content).not.toContain('other-secret');
  expect(response.content).toContain('mine');
  expect(response.content).toContain('event: ready');
  events.close();
});
it('requires a new snapshot after replay overflow or a server epoch change', () => {
  const events = new Events();
  for (let i = 0; i < 600; i++) events.publish('text', { delta: 'x' }, 'a');
  const old = new Response();
  events.subscribe('a', 0, events.epoch, old as unknown as ServerResponse);
  expect(old.content).toContain('event: reset');
  const epoch = new Response();
  events.subscribe('a', events.seq, 'old', epoch as unknown as ServerResponse);
  expect(epoch.content).toContain('event: reset');
  events.close();
});
it('disconnects slow consumers instead of growing their queues indefinitely', () => {
  const events = new Events();
  const response = new Response();
  response.writableLength = 600 * 1024;
  events.subscribe('a', 0, events.epoch, response as unknown as ServerResponse);
  expect(response.destroyed).toBe(true);
  events.close();
});
