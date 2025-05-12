import WebSocket from 'ws';
import { Server } from '../src/impl/Server';
import { IncomingMessage } from 'http';
import { OCPP_PROTOCOL_1_6 } from '../src/impl/schemas';

jest.useFakeTimers();

describe('Server ping/pong implementation', () => {
  let server: Server;
  let mockSocket: WebSocket;
  let mockRequest: IncomingMessage;

  beforeEach(() => {
    server = new Server();
    server.setPingInterval(1); // Set ping interval to 1 second for testing

    mockSocket = {
      on: jest.fn(),
      ping: jest.fn((_, __, callback) => callback && callback(null)),
      close: jest.fn(),
    } as unknown as WebSocket;

    Object.defineProperty(mockSocket, 'protocol', {
      value: OCPP_PROTOCOL_1_6,
      writable: false, // Mimic the read-only behavior
    });

    mockRequest = {
      url: '/chargepoint/delta-001',
    } as IncomingMessage;
  });

  it('should send ping and handle pong response', () => {
    const spyPing = jest.spyOn(mockSocket, 'ping');
    const spyClose = jest.spyOn(mockSocket, 'close');

    server['onNewConnection'](mockSocket, mockRequest);

    // Simulate the 'pong' event listener being registered
    const pongHandler = (mockSocket.on as jest.Mock).mock.calls.find(
      ([event]) => event === 'pong'
    )?.[1];

    // Ensure the pongHandler exists before invoking it
    expect(pongHandler).toBeDefined();

    // Simulate pong response
    if (pongHandler) pongHandler();

    // Fast-forward time to trigger the ping interval
    jest.advanceTimersByTime(1000);

    expect(spyPing).toHaveBeenCalledTimes(1);
    expect(spyClose).not.toHaveBeenCalled();

    // Simulate pong response
    if (pongHandler) pongHandler();

    jest.advanceTimersByTime(1000);
    expect(spyPing).toHaveBeenCalledTimes(2);

    // Simulate no pong response
    jest.advanceTimersByTime(1000);
    expect(spyClose).toHaveBeenCalledTimes(1);
  });

  it('should close the connection if no pong is received', () => {
    const spyClose = jest.spyOn(mockSocket, 'close');

    server['onNewConnection'](mockSocket, mockRequest);

    // Fast-forward time to simulate no pong response
    jest.advanceTimersByTime(2000);

    expect(spyClose).toHaveBeenCalledWith(1001, expect.stringContaining('Didn\'t received pong for 1 seconds, closing delta-001'));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });
});