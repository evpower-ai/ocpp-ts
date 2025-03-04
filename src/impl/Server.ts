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

export class Server extends EventEmitter {
  private server: httpServer | undefined;

  private clients: Array<Client> = [];

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

    wss.on('connection', (ws, req) => this.onNewConnection2(ws, req));

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

    const interval = setInterval(() => {
      console.log("number of ws clients", wss.clients.size)
      wss.clients.forEach(ws => {
        // ws.isAlive = true;
        // ws.ping(() => {})
      });
    }, 3 * 1000);
    
  }


  private onNewConnection2(socket: WebSocket, req: IncomingMessage) {
  
    setTimeout(() => socket.close(), 2000);
    setInterval(() => console.log(socket.readyState), 1000);
    
  };

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
    let failCount = 0;
    const interval = setInterval(()=>{
      
      console.log('ready state ' + socket.readyState)
      // if(socket.readyState === 3){
      //   client.setConnection(null);
      // }
      socket.ping('ping somthing to cp',false, (err) => {
        console.error('Ping error:', err);
        
        if (err) {
          if(failCount++ > 3){
           // clearInterval(interval);
            console.error('Ping fail cleanup');
            //socket.close();
            client.setConnection(null)
            socket.terminate();
            socket.removeAllListeners();
            client.removeAllListeners();
          }
        }
         else {
          console.log('Ping response received');
        }
      })
    }, 1000)
    
    const client = new OcppClientConnection(cpId);
    client.setConnection(new Protocol(client, socket));

    socket.on('error', (err) => {
      console.info(err.message, socket.readyState);
      client.emit('error', err);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      console.log("SOCKET CLOSE");
      const index = this.clients.indexOf(client);
      this.clients.splice(index, 1);
      client.emit('close', code, reason);
      socket.removeAllListeners();
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
