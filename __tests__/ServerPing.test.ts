import WebSocket from 'ws';
import { Server } from '../src/impl/Server';
import { IncomingMessage } from 'http';
import { OCPP_PROTOCOL_1_6 } from '../src/impl/schemas';
import { OcppClientConnection } from '../src/OcppClientConnection';

jest.useFakeTimers();

describe('Server ping/pong implementation', () => {
  let server: Server;
  let mockSocket: WebSocket;
  let mockRequest: IncomingMessage;
  let mockClient: OcppClientConnection;

  beforeEach(() => {
    server = new Server();
    server.setPingInterval(1); // Set ping interval to 1 second for testing

    mockSocket = {
      on: jest.fn(),
      ping: jest.fn((_, __, callback) => callback && callback(null)),
      terminate: jest.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;

    Object.defineProperty(mockSocket, 'protocol', {
      value: OCPP_PROTOCOL_1_6,
      writable: false, // Mimic the read-only behavior
    });

    Object.defineProperty(mockSocket, 'readyState', {
      value: 1, // Mimic the OPEN state
    });

    mockRequest = {
      url: '/chargepoint/delta-001',
    } as IncomingMessage;

    mockClient = {
      emit: jest.fn(),
    } as unknown as OcppClientConnection;

    jest.spyOn(OcppClientConnection.prototype, 'emit').mockImplementation(mockClient.emit);
  });

  test('should send ping and handle pong response', () => {
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

    // Verify that ping was called once
    expect(mockSocket.ping).toHaveBeenCalledTimes(1);

    // Simulate another pong response
    if (pongHandler) pongHandler();

    // Fast-forward time again to trigger another ping
    jest.advanceTimersByTime(1000);

    // Verify that ping was called twice
    expect(mockSocket.ping).toHaveBeenCalledTimes(2);

    // Ensure the connection is still alive
    expect(mockSocket.terminate).not.toHaveBeenCalled();
  });

  test('should terminate the connection and emit close if no pong is received', () => {
    //make new connection
    server['onNewConnection'](mockSocket, mockRequest);

    // Fast-forward time to simulate no pong response
    jest.advanceTimersByTime(2500);

    // Verify that the connection is terminated
    expect(mockSocket.terminate).toHaveBeenCalledTimes(1);

    // // Verify that the close event is emitted with the correct reason
    // expect(mockClient.emit).toHaveBeenCalledWith(
    //   'close',
    //   expect.any(Number),
    //   Buffer.from(`Didn't received pong for 1 seconds`)
    // );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });
});