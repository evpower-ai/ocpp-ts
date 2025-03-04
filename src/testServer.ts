// import { OcppClientConnection } from "./OcppClientConnection";
// import { OcppServer } from "./OcppServer";
import { AuthorizeRequest, AuthorizeResponse, ChangeConfigurationRequest } from "./types";

// const cs = new OcppServer({captureRejections: true}); //});
    
// cs.on('connection', (client: OcppClientConnection) => {
//   console.log('client connection');
//   client
//   .on("Authorize", (request: AuthorizeRequest, cb: (response: AuthorizeResponse) => void) => {
//     console.log('Authorize request');
//     cb({idTagInfo: {status:'Accepted'}})
//   })
//   .on('error',(err: any) =>{
//     console.log('@@@@ error',err);
//   })
//   .on('close',()=>{
//     console.log('@@@@ client closed');
    
//   });
  


// //   const req:ChangeConfigurationRequest = {
// //     key: 'WebSocketPingInterval',
// //     value: '10',
// //   }
// //   client.callRequest('ChangeConfiguration',req)
// //   .catch(err =>{console.log(err);})
// //   .then(() =>{
// //     console.log('sent change configuration');
// //   });
  
// })

// cs.listen(3000);
// console.log('listening on port 3000');

import stream from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer as createHttpServer, IncomingMessage, Server as httpServer } from 'http';
import { OCPP_PROTOCOL_1_6 } from "./impl/schemas";

const server = createHttpServer();

   const wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has(OCPP_PROTOCOL_1_6)) {
          return OCPP_PROTOCOL_1_6;
        }
        return false;
      },
    });

    server.on('upgrade', (req: IncomingMessage, socket: stream.Duplex, head: Buffer) => {
      const cpId = "123";//lServer.getCpIdFromUrl(req.url);
      if (!cpId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
      } else {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    });

    // this.server.listen(port);


    const interval = setInterval(() => {
      console.log("number of ws clients", wss.clients.size)
      wss.clients.forEach(ws => {
        // ws.isAlive = true;
        // ws.ping(() => {})
      });
    }, 3 * 1000);
    
    wss.on('connection', onNewConnection2);

    function onNewConnection2(socket: WebSocket, req: IncomingMessage) {
        console.log('client connected');
        setTimeout(() => socket.close(), 2000);
        setInterval(() => console.log(socket.readyState), 1000);
    
        // setTimeout(() => wss.removeListener("connection", onNewConnection2) , 3000);
    };



    // setInterval(() => {
    //     console.log(process._getActiveHandles())
    // }, 3000)
  server.listen(3000);