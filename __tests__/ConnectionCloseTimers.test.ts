import { OcppServer, OcppClientConnection, OcppError } from '../src';
import { OcppClient } from '../src/OcppClient';
import { Protocol } from '../src/impl/Protocol';

// Reproduces, over real WebSockets, what evpower-ocpp-gateway hit: a handler that never answers
// (e.g. the gateway closing the CP socket instead of replying) left Protocol.onCall's
// "No response from the handler" timer armed for the full protocolTimeout after the connection
// was gone. It kept the process alive (Jest "open handle") and later fired a CALLERROR at a dead
// socket. Outgoing calls in flight when the peer disconnected likewise only settled at timeout.

const PORT = 8090;
const URL = `ws://localhost:${PORT}/`;
const PROTOCOL_TIMEOUT = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('connection close releases protocol timers', () => {
  let server: OcppServer;
  let client: OcppClient;
  let callErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    callErrorSpy = jest.spyOn(Protocol.prototype as any, 'callError');
    server = new OcppServer(PROTOCOL_TIMEOUT);
    server.listen(PORT);
    client = new OcppClient('CP-TIMERS-1', PROTOCOL_TIMEOUT);
  });

  afterEach(async () => {
    client.close();
    server.close();
    callErrorSpy.mockRestore();
    await sleep(50);
  });

  async function connect(): Promise<OcppClientConnection> {
    const serverSide = new Promise<OcppClientConnection>((resolve) => server.on('connection', resolve));
    client.connect(URL);
    await new Promise<void>((resolve) => client.on('connect', resolve));
    return serverSide;
  }

  const handlerTimeoutErrors = () => callErrorSpy.mock.calls
    .filter(([, err]) => err instanceof OcppError && err.info === 'No response from the handler');

  test('server closes the socket instead of answering: handler timeout must not outlive the connection', async () => {
    const cp = await connect();
    const clientClosed = new Promise<void>((resolve) => client.on('close', () => resolve()));
    cp.on('Heartbeat', () => cp.close()); // drop the call, close the socket — never call cb

    client.callRequest('Heartbeat', {}).catch(() => { });
    await clientClosed;

    await sleep(PROTOCOL_TIMEOUT + 300);
    expect(handlerTimeoutErrors()).toHaveLength(0);
  });

  test('client disconnects while the server handler is still pending: handler timeout must not outlive the connection', async () => {
    const cp = await connect();
    const serverSawClose = new Promise<void>((resolve) => cp.on('close', () => resolve()));
    cp.on('Heartbeat', () => client.close()); // handler still "working" when the peer goes away

    client.callRequest('Heartbeat', {}).catch(() => { });
    await serverSawClose;

    await sleep(PROTOCOL_TIMEOUT + 300);
    expect(handlerTimeoutErrors()).toHaveLength(0);
  });

  test('server-side outgoing call rejects as soon as the client disconnects, not at protocolTimeout', async () => {
    const cp = await connect();
    client.on('Reset', () => client.close()); // never answers, just disconnects

    const start = Date.now();
    await expect(cp.callRequest('Reset', { type: 'Soft' })).rejects.toBeInstanceOf(OcppError);
    expect(Date.now() - start).toBeLessThan(PROTOCOL_TIMEOUT / 2);
  });

  test('client-side outgoing call rejects as soon as the server drops the connection, not at protocolTimeout', async () => {
    const cp = await connect();
    cp.on('Heartbeat', () => cp.close());

    const start = Date.now();
    await expect(client.callRequest('Heartbeat', {})).rejects.toBeInstanceOf(OcppError);
    expect(Date.now() - start).toBeLessThan(PROTOCOL_TIMEOUT / 2);
  });
});
