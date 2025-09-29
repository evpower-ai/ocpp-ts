import { SecureContextOptions } from 'tls';
import { IncomingMessage } from 'http';
import { Server } from './impl/Server';
import { OcppClientConnection } from './OcppClientConnection';
import StatusCode from 'status-code-enum';

export class OcppServer extends Server {
  public setPingInterval(pingInterval: number) {
    super.setPingInterval(pingInterval);
  }

  constructor(protocolTimeout: number) {
    super();
    this.setProtocolTimeout(protocolTimeout);
  }

  listen(port: number = 9220, options?: SecureContextOptions) {

    super.listen(port, options);
  }

  close() {
    super.close();
  }

  on(event: 'authorization', listener: (cpId: string, req: IncomingMessage, cb: (status?: StatusCode) => void) => void): this;
  on(event: 'connection', listener: (client: OcppClientConnection) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void) {
    return super.on(event, listener);
  }

}
