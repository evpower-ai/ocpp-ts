import { IncomingMessage } from 'http';
import fs from 'fs';
import {
  OcppServer, OcppClientConnection, BootNotificationRequest, BootNotificationResponse,
} from '../src';

const cs = new OcppServer(30000);
cs.on('connection', (client: OcppClientConnection) => {
  console.log(`Client ${client.getCpId()} connected`);
  client.on('close', (code: number, reason: Buffer) => {
    console.log(`Client ${client.getCpId()} closed connection`, code, reason.toString());
  });

  client.on('BootNotification', (request: BootNotificationRequest, cb: (response: BootNotificationResponse) => void) => {
    const response: BootNotificationResponse = {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 60,
    };
    cb(response);
  });
});

cs.on('authorization', (cbId: string, req: IncomingMessage, cb: (err?: Error) => void) => {
  console.log('authorization', cbId, req.headers.authorization);
  // validate authorization header
  // cb(new Error('Unathorized')); // Deny
  cb(); // Accept
});
cs.listen(9220, {
  cert: fs.readFileSync('cert.pem'),
  key: fs.readFileSync('key.pem'),
});
