import { OcppServer } from '../src/OcppServer';
import { OcppClient } from '../src/OcppClient';
describe('WebSocket Tests', () => {
    it('can server ping client', () => {
      const server = new OcppServer();
      server.setPingInterval(1);
      server.listen(9220);
      server.on('connection', (client) => {
        client.on('close', () => {
          console.log('Received pong from client');
        })
    })

    const client = new OcppClient('cp-xxx');
    client.connect('ws://localhost:9220/cp-xxx');
    client.on('connect', () => {
      console.log('Connected to server');
    });
    client.on('error', (err) => {
      console.error('Error:', err);
    });
    client.on('close', (code, reason) => {
      console.log('Connection closed:', code, reason.toString());
    });
    //   expect(t).toThrow(ERROR_FORMATIONVIOLATION)
    });
})