import EventEmitter from 'events';
import WebSocket, { WebSocketServer } from 'ws';
import { SecureContextOptions } from 'tls';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer, IncomingMessage, Server as httpServer } from 'http';
import stream from 'node:stream';
import { OCPP_PROTOCOL_1_6 } from './schemas';
import { Client } from './Client';
import { OcppClientConnection } from '../OcppClientConnection';
import { Protocol } from './Protocol';
const pingInterval =1000;
export class Server extends EventEmitter {
  private server: httpServer | undefined;

  private clients: Array<OcppClientConnection> = [];

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

    console.log(`new client connection cpid: ${cpId}`);
    for(let i=0;i<this.clients.length;i++){
      if(this.clients[i].getCpId()===cpId){
        console.log(`already has client with cpid: ${cpId}, deleting client from array`);
        this.clients[i].close();
        this.clients[i].removeAllListeners();
        this.clients[i].setConnection(null);
        this.clients.splice(i,1);
      }
    }
   
    const client = new OcppClientConnection(cpId);
    client.setConnection(new Protocol(client, socket));

    const intervalId = setInterval(() => {
      socket.ping(cpId,false,(err)=>{
        if(err){
          const code = 1000;
          console.error(`error while ws ping to: ${cpId}, error: ${err}`);
          socket.terminate();
          socket.close(code,`error while ws ping to: ${cpId}, error: ${err}`);
          clearInterval(intervalId);
        }
      });
    }, pingInterval);

    socket.on('error', (err) => {
      console.info(err.message, socket.readyState);
      client.emit('error', err);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      console.log(`socket on close: ${cpId}`);
      
      client.emit('close', code, reason);
      client.close()

      const index = this.clients.indexOf(client);
      if(index !== -1) this.clients[index].setConnection(null);
      this.clients.splice(index, 1);
      
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
