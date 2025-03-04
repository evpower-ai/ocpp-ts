const WebSocket = require('ws');
const WebSocketServer = WebSocket.WebSocketServer;
const { createServer: createHttpServer } = require('http');
const { Socket } = require('dgram');
const OCPP_PROTOCOL_1_6  = 'ocpp1.6';// = require("./impl/schemas");
//const {WeakRef, FinalizationRegistry} = require('node:weak-ref')


const socketRegistry = new FinalizationRegistry((heldValue) => {
    console.log(`Socket ${heldValue} has been garbage collected`);
  });

let socketCounter = 0;



const server = createHttpServer();

   const wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => {
        if (protocols.has(OCPP_PROTOCOL_1_6)) {
          return OCPP_PROTOCOL_1_6;
        }
        return false;
      },
    });

    server.on('upgrade', (req, socket, head) => {
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

    function onNewConnection2(socket, req) {
        const socketId = socketCounter++;
        console.log(`Client ${socketId} connected`);
    
        const weakSocket = new WeakRef(socket);
        // socketRegistry.register(socket, socketId);

        // setTimeout(() => {
        //     socket.close();
        //     console.log(`Socket ${socketId} closed`);
        // }, 2000);
    
        // Optional: periodically check if the socket is still accessible
        const checkInterval = setInterval(() => {
            const socketStillExists = weakSocket.deref();
            if (socketStillExists) {
                console.log(`Socket ${socketId} still exists, state: ${socketStillExists.readyState}`);
            } else {
                console.log(`Socket ${socketId} no longer accessible`);
                clearInterval(checkInterval);
            }
        }, 1000)

        

        socket.on('error', (err) => {
            console.info(err.message, socket.readyState);
            // client.emit('error', err);
          });
      
          socket.on('close', (code, reason) => {
            console.log("SOCKET CLOSE");
            // const index = this.clients.indexOf(client);
            // this.clients.splice(index, 1);
            // client.emit('close', code, reason);
            socket.removeAllListeners();
          });


        // setTimeout(() => socket.close(), 2000);
        // setInterval(() => console.log(socket.readyState), 1000);
    
        // setTimeout(() => wss.removeListener("connection", onNewConnection2) , 3000);
    };

    // setInterval(() => {
    //     console.log(process._getActiveHandles())
    // }, 3000)
    server.listen(3000);


    // setInterval(() => {
    //     const activeHandles = process._getActiveHandles();
    //     const webSocketHandles = activeHandles.filter(handle => handle instanceof WebSocket);
    //     console.log(`Active WebSocket handles: ${webSocketHandles.length}, ${activeHandles.length}`);
    //     // console.log(activeHandles);
    // }, 1000);