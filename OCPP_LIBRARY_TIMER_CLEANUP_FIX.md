# Fix: Timer Leaks in `@evpower/ocpp-ts` Protocol Class

## Problem

The `Protocol` class in `src/impl/Protocol.ts` creates `setTimeout` timers that are **never cleared**, even after the response arrives or the connection closes. This causes resource leaks that prevent Node.js processes (and test runners like Jest) from exiting cleanly.

There are **two** bugs in `Protocol.ts` and **one** in `Client.ts`.

---

## Bug 1: `callRequest` timeout is never cleared on success or error

**File:** `src/impl/Protocol.ts`, method `callRequest` (~line 66)

**Current code:**
```typescript
public callRequest(request: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const messageId = uuidv4();
      const result = JSON.stringify([CALL_MESSAGE, messageId, request, payload]);
      this.socket.send(result);
      this.pendingCalls[messageId] = {
        resolve,
        reject,
      };

      setTimeout(() => {
        this.onCallError(messageId, ERROR_INTERNALERROR, `No response from the client for: ${this.timeout}ms, for ${request}`, {});
      }, this.timeout);
    } catch (e) {
      console.error(e);
      reject(e);
    }
  });
}
```

**What's wrong:** The `setTimeout` return value is never stored, so it can never be cleared. When `onCallResult` or `onCallError` is called (i.e., the response arrives before the timeout), the timer keeps running in the background for the full `protocolTimeout` duration (default 10–30 seconds). If many requests are made, many orphaned timers accumulate.

**Fix:** Store the timer ID alongside `resolve`/`reject` in `pendingCalls`. Clear it in both `onCallResult` and `onCallError`.

```typescript
public callRequest(request: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const messageId = uuidv4();
      const result = JSON.stringify([CALL_MESSAGE, messageId, request, payload]);
      this.socket.send(result);

      const timer = setTimeout(() => {
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
```

Then update `onCallResult` to clear the timer:

```typescript
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
```

And update `onCallError` to clear the timer:

```typescript
private onCallError(messageId: string, errorCode: string, errorDescription: string, errorDetails: any) {
  if (this.pendingCalls[messageId]) {
    const { reject, timer } = this.pendingCalls[messageId];
    clearTimeout(timer);
    if (reject) {
      reject(new OcppError(errorCode, errorDescription, errorDetails));
    }
    delete this.pendingCalls[messageId];
  }
}
```

---

## Bug 2: `onCall` handler timeout is never cleared when handler responds

**File:** `src/impl/Protocol.ts`, method `onCall` (~line 127)

**Current code:**
```typescript
private async onCall(messageId: string, request: string, payload: any) {
  try {
    const validator = Protocol.validators[request];
    validator.validate(payload);
    const response = await new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new OcppError(ERROR_INTERNALERROR, 'No response from the handler'));
      }, this.timeout);

      const hasListener = this.eventEmitter.emit(request, payload, (result: any) => {
        resolve(result);
      });
      if (!hasListener) {
        reject(new OcppError(ERROR_NOTIMPLEMENTED, `Listener for action "${request}" not set`));
      }
    });
    this.callResult(messageId, request, response);
  } catch (e) { ... }
}
```

**What's wrong:** The `setTimeout` inside the inner `Promise` is never cleared. When the handler calls the callback (i.e., `resolve(result)` runs), the promise settles but the timer keeps running. When it eventually fires, `reject` is called on an already-settled promise (a no-op), but the timer itself keeps the Node.js event loop alive until it expires.

**Fix:** Store the timer and clear it when the handler responds or when there is no listener.

```typescript
private async onCall(messageId: string, request: string, payload: any) {
  try {
    const validator = Protocol.validators[request];
    validator.validate(payload);
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new OcppError(ERROR_INTERNALERROR, 'No response from the handler'));
      }, this.timeout);

      const hasListener = this.eventEmitter.emit(request, payload, (result: any) => {
        clearTimeout(timer);
        resolve(result);
      });
      if (!hasListener) {
        clearTimeout(timer);
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
```

---

## Bug 3: `Client.close()` does not clear pending call timers

**File:** `src/impl/Client.ts`, method `close` (~line 72)

**Current code:**
```typescript
public close(code?: number, reason?: string) {
  this.connection?.socket.close(code, reason);
  this.ws?.close(code, reason);
}
```

**What's wrong:** When a client connection is closed, any pending call timers in `Protocol.pendingCalls` are left running. They will fire after the connection is gone, calling `reject` on dead promises while keeping the event loop alive.

**Fix:** Add a `dispose` method to `Protocol` that clears all pending call timers, and call it from `Client.close()`.

In `Protocol.ts`, add:
```typescript
public dispose(): void {
  Object.keys(this.pendingCalls).forEach((messageId) => {
    const { timer } = this.pendingCalls[messageId];
    if (timer) clearTimeout(timer);
    delete this.pendingCalls[messageId];
  });
}
```

In `Client.ts`, update `close`:
```typescript
public close(code?: number, reason?: string) {
  this.connection?.dispose();
  this.connection?.socket.close(code, reason);
  this.ws?.close(code, reason);
}
```

---

## Bug 4: `Server.close()` does not terminate WebSocket connections or clean up ping intervals

**File:** `src/impl/Server.ts`

**Current code:**
```typescript
protected listen(port = 9220, options?: SecureContextOptions) {
    // ...
    const wss = new WebSocketServer({ noServer: true, ... });
    // ...
    this.server.listen(port);
}

protected close() {
    this.server?.close();
    this.clients.forEach((client) => client.close());
}
```

**What's wrong — two problems:**

1. **The `WebSocketServer` (`wss`) is a local variable in `listen()`** — it's never stored on the instance, so `close()` can never shut it down.

2. **`client.close()` initiates a graceful WebSocket close handshake**, which is async. The server-side `socket.on('close')` handler (which calls `clearInterval(pingTimerInterval)`) only fires after the handshake completes. If the process is shutting down, the handshake may never complete, so the 30-second ping `setInterval` is never cleared, keeping the event loop alive.

**Fix:** Store `wss` as an instance field. In `close()`, terminate all WebSocket connections immediately (which synchronously fires the `'close'` event, clearing ping intervals), then close both the `WebSocketServer` and the HTTP server.

```typescript
export class Server extends EventEmitter {
  private server: httpServer | undefined;
  private wss: WebSocketServer | undefined;  // ADD THIS

  // ... existing fields ...

  protected listen(port = 9220, options?: SecureContextOptions) {
    if (options) {
      this.server = createHttpsServer(options || {});
    } else {
      this.server = createHttpServer();
    }

    this.wss = new WebSocketServer({       // CHANGE: store on instance
      noServer: true,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has(OCPP_PROTOCOL_1_6)) {
          return OCPP_PROTOCOL_1_6;
        }
        return false;
      },
    });

    this.wss.on('connection', (ws, req) => this.onNewConnection(ws, req));

    this.server.on('upgrade', (req, socket, head) => {
      const cpId = Server.getCpIdFromUrl(req.url);
      if (!cpId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
      } else if (this.listenerCount('authorization')) {
        this.emit('authorization', cpId, req, (status?: StatusCode) => {
          if (status && status !== StatusCode.SuccessOK) {
            socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n\r\n`);
            socket.destroy();
          } else {
            this.wss!.handleUpgrade(req, socket, head, (ws) => {
              this.wss!.emit('connection', ws, req);
            });
          }
        });
      } else {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      }
    });

    this.server.listen(port);
  }
```

Then update `close()` to use `terminate()` instead of `close()` on each client's underlying socket, and also close the `WebSocketServer`:

```typescript
  protected close() {
    // Terminate all WebSocket connections immediately.
    // terminate() force-closes the socket which synchronously fires the
    // 'close' event on each socket, ensuring the ping interval is cleared.
    this.wss?.clients.forEach((ws) => ws.terminate());

    // Close the WebSocket server (stops accepting new connections)
    this.wss?.close();

    // Close the HTTP server
    this.server?.close();

    this.clients = [];
  }
```

**Why `terminate()` instead of `close()`:** `ws.close()` starts a graceful handshake that may never complete during shutdown. `ws.terminate()` immediately destroys the underlying socket, which synchronously triggers the `socket.on('close')` handler where `clearInterval(pingTimerInterval)` lives. This guarantees the ping intervals are cleaned up.

---

## Summary of Changes

| File | What to change |
|---|---|
| `src/impl/Protocol.ts` | Store `timer` in `pendingCalls` entries in `callRequest`. Clear it in `onCallResult` and `onCallError`. |
| `src/impl/Protocol.ts` | Clear the `setTimeout` in `onCall` when the handler callback fires or when there's no listener. |
| `src/impl/Protocol.ts` | Add `dispose()` method that clears all pending call timers. |
| `src/impl/Client.ts` | Call `this.connection?.dispose()` in `close()` before closing the socket. |
| `src/impl/Server.ts` | Store `WebSocketServer` as instance field `wss` instead of local variable. |
| `src/impl/Server.ts` | In `close()`: terminate all WS clients via `wss.clients`, close `wss`, close HTTP server. |

## How to Verify

After applying the fixes, run the library's own tests:
```bash
npm test
```

Then, in the consuming project (`evpower-charger-service`), run:
```bash
cross-env NODE_ENV=test jest --detectOpenHandles
```

Jest should exit cleanly with **no** "open handles" warning and without needing `--forceExit`.
