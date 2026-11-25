import EventEmitter from 'events';
import WebSocket from 'ws';
import { Protocol } from '../src/impl/Protocol';
import { OcppError } from '../src/impl/OcppError';

const TIMEOUT = 30000;

function setup() {
  const socket = new EventEmitter() as EventEmitter & { send: jest.Mock };
  socket.send = jest.fn();
  const handlers = new EventEmitter();
  const protocol = new Protocol(handlers, socket as unknown as WebSocket, TIMEOUT);
  return { socket, handlers, protocol };
}

describe('Protocol.dispose', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('clears the handler timeout of an incoming call that was never answered', () => {
    const { socket, handlers, protocol } = setup();
    handlers.on('Heartbeat', () => { /* never calls cb */ });

    socket.emit('message', Buffer.from(JSON.stringify([2, 'msg-1', 'Heartbeat', {}])));
    expect(jest.getTimerCount()).toBe(1);

    protocol.dispose();
    expect(jest.getTimerCount()).toBe(0);

    // The timeout must not fire later and try to send a CALLERROR on the dead socket.
    jest.advanceTimersByTime(TIMEOUT * 2);
    expect(socket.send).not.toHaveBeenCalled();
  });

  test('answered incoming calls do not leave a timer behind', async () => {
    const { socket, handlers } = setup();
    handlers.on('Heartbeat', (_req, cb) => cb({ currentTime: new Date().toISOString() }));

    socket.emit('message', Buffer.from(JSON.stringify([2, 'msg-1', 'Heartbeat', {}])));
    await Promise.resolve();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  test('settled incoming calls are not kept in pendingHandlerTimers', async () => {
    const { socket, handlers, protocol } = setup();
    handlers.on('Heartbeat', (_req, cb) => cb({ currentTime: new Date().toISOString() }));
    handlers.on('BootNotification', () => { /* never answers */ });

    socket.emit('message', Buffer.from(JSON.stringify([2, 'msg-1', 'Heartbeat', {}])));
    socket.emit('message', Buffer.from(JSON.stringify([2, 'msg-2', 'StatusNotification', { connectorId: 1, errorCode: 'NoError', status: 'Available' }]))); // no listener
    socket.emit('message', Buffer.from(JSON.stringify([2, 'msg-3', 'BootNotification', { chargePointModel: 'M', chargePointVendor: 'V' }])));
    await Promise.resolve();

    // Only the unanswered BootNotification is still pending.
    expect((protocol as any).pendingHandlerTimers.size).toBe(1);

    jest.advanceTimersByTime(TIMEOUT);
    expect((protocol as any).pendingHandlerTimers.size).toBe(0);
  });

  test('rejects outgoing calls still awaiting a reply and clears their timers', async () => {
    const { protocol } = setup();
    const pending = protocol.callRequest('Reset', { type: 'Soft' });
    expect(jest.getTimerCount()).toBe(1);

    protocol.dispose();

    await expect(pending).rejects.toBeInstanceOf(OcppError);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('callRequest after dispose rejects immediately without sending', async () => {
    const { socket, protocol } = setup();
    protocol.dispose();

    await expect(protocol.callRequest('Reset', { type: 'Soft' })).rejects.toBeInstanceOf(OcppError);
    expect(socket.send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('dispose is idempotent', () => {
    const { protocol } = setup();
    protocol.dispose();
    expect(() => protocol.dispose()).not.toThrow();
  });
});
