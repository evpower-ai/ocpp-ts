import EventEmitter from 'events';
import { OutgoingHttpHeaders } from 'http';
import WebSocket from 'ws';
import { Protocol } from './Protocol';
import { OCPP_PROTOCOL_1_6 } from './schemas';

export class Client extends EventEmitter {
  private protocolTimeout: number;
  private connection: Protocol | null = null;

  private cpId: string;

  private ws: WebSocket | undefined;

  private terminationReason: string | undefined;

  constructor(cpId: string, protocolTimeout = 30000) {
    super();
    this.cpId = cpId;
    this.protocolTimeout = protocolTimeout;
  }

  protected getCpId(): string {
    return this.cpId;
  }

  protected setConnection(connection: Protocol | null): void {
    this.connection = connection;
  }

  protected callRequest(request: string, payload: any): Promise<any> {
    if (this.connection) {
      return this.connection.callRequest(request, payload);
    }
    return Promise.reject('Charging point not connected to central system');
  }

  protected connect(centralSystemUrl: string, headers?: OutgoingHttpHeaders) {
    this.ws = new WebSocket(centralSystemUrl + this.getCpId(), [OCPP_PROTOCOL_1_6], {
      perMessageDeflate: false,
      protocolVersion: 13,
      headers,
    });

    this.ws.on('upgrade', (res) => {
      if (!res.headers['sec-websocket-protocol']) {
        this.emit('error', new Error(`Server doesn't support protocol ${OCPP_PROTOCOL_1_6}`));
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.setConnection(null);
      this.emit('close', code, reason);
    });

    this.ws.on('open', () => {
      if (this.ws) {
        this.setConnection(new Protocol(this, this.ws, this.protocolTimeout));
        this.emit('connect');
      }
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  public close(code?: number, reason?: string) {
    this.connection?.socket.close(code, reason);
    this.ws?.close(code, reason);
  }

}
