import { BootNotificationRequest, OcppServer } from "../src";
import { OcppClient } from '../src/OcppClient';
describe('websocket test', () => {
  test('fff', async () => {
    const client = new OcppClient('CP1234');
    const pingInterval = 1; // seconds

    const server = new OcppServer(10000);
    server.setPingInterval(pingInterval);
    server.listen(8080);

    client.connect('ws://localhost:8080/');

    const p = new Promise<void>((resolve, reject) => {
      client.on('connect', async () => {
        console.log('Client connected to server');
        const ws = client['ws'] as unknown as WebSocket;
        //make sure we set the autoPong to false before the ping is sent again.
        const s = ws as any
        s._autoPong = false;
      });

      client.on('error', (err) => {
        console.error('Client error:', err);
      });

      client.on('close', (code, reason) => {
        console.log(`Client disconnected: ${code} - ${reason.toString()}`);
        // expect(reason.toString()).toMatch(`No pong received from client in the last ping interval, pingInterval: ${pingInterval} seconds`);
        expect(code).toBe(1006); // Abnormal Closure
        resolve();
      });
    });
    await p;
  });

});

