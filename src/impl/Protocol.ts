import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import schemas from './schemas';
import {
  ERROR_INTERNALERROR,
  ERROR_NOTIMPLEMENTED,
  OcppError,
} from './OcppError';
import { SchemaValidator } from './SchemaValidator';

const CALL_MESSAGE = 2; // Client-to-Server
const CALLRESULT_MESSAGE = 3; // Server-to-Client
const CALLERROR_MESSAGE = 4; // Server-to-Client

export class Protocol {
  static schemaHolder: { [key: string]: any } = {};
  static validators: { [key: string]: SchemaValidator } = {};
  pendingCalls: any = {};

  // "No response from the handler" timers for incoming calls still awaiting the local handler's cb.
  private pendingHandlerTimers = new Set<NodeJS.Timeout>();

  private disposed = false;

  eventEmitter: EventEmitter;

  socket: WebSocket;
  private timeout = 30000;
  constructor(eventEmitter: EventEmitter, socket: WebSocket, timeout: number) {
    this.eventEmitter = eventEmitter;
    this.socket = socket;
    this.socket.on('message', (message) => {
      this.onMessage(message.toString());
    });
    Protocol.schemaHolder = schemas;
    Object.keys(Protocol.schemaHolder).forEach((key) => {
      Protocol.validators[key] = new SchemaValidator(Protocol.schemaHolder[key]);
    });
    this.timeout = timeout;
  }

  onMessage(message: string) {
    try {
      const [messageType, ...rest] = JSON.parse(message);
      if (!Array.isArray(rest)) {
        throw new Error('ProtocolError');
      }

      if (messageType === CALL_MESSAGE && rest.length === 3) {
        const [messageId, action, payload] = rest;
        this.onCall(messageId, action, payload);
      } else if (messageType === CALLRESULT_MESSAGE && rest.length === 2) {
        const [messageId, payload] = rest;
        this.onCallResult(messageId, payload);
      } else if (messageType === CALLERROR_MESSAGE && rest.length === 4) {
        const [messageId, errorCode, errorDescription, errorDetails] = rest;
        this.onCallError(messageId, errorCode, errorDescription, errorDetails);
      } else {
        throw new Error('ProtocolError');
      }
    } catch (err) {
      if (err instanceof SyntaxError || err instanceof Error) {
        console.error(err.message);
      }
    }
  }

  public callRequest(request: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new OcppError(ERROR_INTERNALERROR, `Connection closed, cannot send ${request}`));
        return;
      }
      try {
        const messageId = uuidv4();
        const result = JSON.stringify([CALL_MESSAGE,
          messageId,
          request,
          payload]);
        this.socket.send(result);

        const timer = setTimeout(() => {
          // timeout error
          this.onCallError(messageId, ERROR_INTERNALERROR, `No response from the client for: ${this.timeout}ms, for ${request}`, {});
        }, this.timeout);

        this.pendingCalls[messageId] = {
          resolve,
          reject,
          timer,
        };
      } catch (e) {
        console.error(e);
        reject(e);
      }
    });
  }

  private callError(messageId: string, error: OcppError) {
    try {
      const result = JSON.stringify([CALLERROR_MESSAGE,
        messageId,
        error.code,
        error.message,
        error.details || {}]);
      this.socket.send(result);
    } catch (e) {
      console.error(e);
    }
  }

  private onCallError(
    messageId: string,
    errorCode: string,
    errorDescription: string,
    errorDetails: any,
  ) {
    if (this.pendingCalls[messageId]) {
      const { reject, timer } = this.pendingCalls[messageId];
      clearTimeout(timer);
      if (reject) {
        reject(new OcppError(errorCode, errorDescription, errorDetails));
      }
      delete this.pendingCalls[messageId];
    }
  }

  private onCallResult(messageId: string, payload: any) {
    if (this.pendingCalls[messageId]) {
      const { resolve, timer } = this.pendingCalls[messageId];
      clearTimeout(timer);
      if (resolve) {
        resolve(payload);
      }
      delete this.pendingCalls[messageId];
    }
  }

  private async onCall(messageId: string, request: string, payload: any) {
    try {
      // @ts-ignore

      const validator = Protocol.validators[request];
      validator.validate(payload);
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingHandlerTimers.delete(timer);
          // timeout error
          reject(new OcppError(ERROR_INTERNALERROR, 'No response from the handler'));
        }, this.timeout);
        this.pendingHandlerTimers.add(timer);
        // Every path that settles this call must go through here, or the timer stays in
        // pendingHandlerTimers until the connection closes.
        const releaseTimer = () => {
          clearTimeout(timer);
          this.pendingHandlerTimers.delete(timer);
        };

        const hasListener = this.eventEmitter.emit(request, payload, (result: any) => {
          releaseTimer();
          resolve(result);
        });
        if (!hasListener) {
          releaseTimer();
          reject(new OcppError(ERROR_NOTIMPLEMENTED, `Listener for action "${request}" not set`));
        }
      });
      this.callResult(messageId, request, response);
    } catch (e) {
      if (e instanceof OcppError) {
        this.callError(messageId, e);
      } else {
        this.callError(
          messageId,
          new OcppError(
            ERROR_INTERNALERROR,
            'An internal error occurred and the receiver was not able to process the requested Action',
          ),
        );
      }
    }
  }

  /**
   * Release everything tied to this connection. Safe to call more than once.
   * - Outgoing calls still awaiting a reply are rejected now (instead of hanging, or waiting
   *   for the response timeout on a socket that can no longer deliver one).
   * - Incoming calls whose handler never answered have their timeout timers cleared; there is
   *   no socket left to send the CALLERROR on, so they are simply dropped.
   */
  public dispose(): void {
    this.disposed = true;
    Object.keys(this.pendingCalls).forEach((messageId) => {
      const { reject, timer } = this.pendingCalls[messageId];
      if (timer) clearTimeout(timer);
      delete this.pendingCalls[messageId];
      if (reject) reject(new OcppError(ERROR_INTERNALERROR, 'Connection closed before a response was received'));
    });
    this.pendingHandlerTimers.forEach((timer) => clearTimeout(timer));
    this.pendingHandlerTimers.clear();
  }

  private callResult(messageId: string, action: string, responsePayload: any) {
    try {
      const result = JSON.stringify([
        CALLRESULT_MESSAGE,
        messageId,
        responsePayload]);
      this.socket.send(result);
    } catch (e) {
      if (e instanceof SyntaxError) {
        this.callError(messageId, new OcppError(ERROR_INTERNALERROR, 'Response payload is invalid'));
        console.error(e.message);
      }
    }
  }
}
