import EventEmitter from 'events';
import WebSocket, { WebSocketServer, CLOSING } from 'ws';
import { SecureContextOptions } from 'tls';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer, IncomingMessage, Server as httpServer } from 'http';
import stream from 'node:stream';
import { OCPP_PROTOCOL_1_6 } from './schemas';
import { Client } from './Client';
import { OcppClientConnection } from '../OcppClientConnection';
import { Protocol } from './Protocol';

const DEFAULT_PING_INTERVAL = 30; // seconds
export class Server extends EventEmitter {
  private server: httpServer | undefined;

  private clients: Array<Client> = [];

  private pingInterval: number = DEFAULT_PING_INTERVAL; // seconds

  private protocolTimeout: number = 30000; // milliseconds

  public setPingInterval(pingInterval: number) {
    this.pingInterval = pingInterval;
  }

  public setProtocolTimeout(timeout: number) {
    this.protocolTimeout = timeout;
  }

  protected listen(port = 9220, options?: SecureContextOptions) {
    if (options) {
      this.server = createHttpsServer(options || {});
    } else {
      this.server = createHttpServer();
    }

    const wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has(OCPP_PROTOCOL_1_6)) {
          return OCPP_PROTOCOL_1_6;
        }
        return false;
      },
    });

    wss.on('connection', (ws, req) => this.onNewConnection(ws, req));

    this.server.on('upgrade', (req: IncomingMessage, socket: stream.Duplex, head: Buffer) => {
      const cpId = Server.getCpIdFromUrl(req.url);
      if (!cpId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
      } else if (this.listenerCount('authorization')) {
        this.emit('authorization', cpId, req, (err?: Error) => {
          if (err) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
          } else {
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit('connection', ws, req);
            });
          }
        });
      } else {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    });

    this.server.listen(port);
  }

  private onNewConnection(socket: WebSocket, req: IncomingMessage) {
    
    const cpId = Server.getCpIdFromUrl(req.url);
    if (!socket.protocol || !cpId) {
      // From Spec: If the Central System does not agree to using one of the subprotocols offered
      // by the client, it MUST complete the WebSocket handshake with a response without a
      // Sec-WebSocket-Protocol header and then immediately close the WebSocket connection.
      console.info('Closed connection due to unsupported protocol');
      socket.close();
      return;
    }

    const client = new OcppClientConnection(cpId);
    client.setHeaders(req.headers);
    client.setConnection(new Protocol(client, socket, this.protocolTimeout));

    let isAlive = true;
    socket.on('pong', () => {
      // console.info('received pong from client', cpId);
      isAlive = true;
    });
    let isPingPongTerminated = false;
    const pingTimerInterval = setInterval(() => {
      if (isAlive === false) {
        // console.info('did not get pong, terminating connection', cpId);
        isPingPongTerminated = true;
        socket.terminate();
        return;
      }

      if (socket.readyState < CLOSING) {
        isAlive = false;
        socket.ping(cpId, false, (err) => {
          if (err) {
            // console.info('error on ping', err.message);
            isPingPongTerminated = true;
            socket.terminate();
          }
        });
      }
    }, this.pingInterval * 1000);

    socket.on('error', (err) => {
      console.info(err.message, socket.readyState);
      client.emit('error', err);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      clearInterval(pingTimerInterval);
      const index = this.clients.indexOf(client);
      this.clients.splice(index, 1);
      const r = isPingPongTerminated ? Buffer.from(`Did not received pong for ${this.pingInterval} seconds`) : reason;
      client.emit('close', code, r);
    });
    this.clients.push(client);
    this.emit('connection', client);
  }

  protected close() {
    this.server?.close();
    this.clients.forEach((client) => client.close());
  }

  static getCpIdFromUrl(url: string | undefined): string | undefined {
    try {
      if (url) {
        const encodedCpId = url.split('/')
          .pop();
        if (encodedCpId) {
          return decodeURI(encodedCpId.split('?')[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
    return undefined;
  }
}
