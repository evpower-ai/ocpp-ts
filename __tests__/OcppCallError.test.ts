import { BootNotificationRequest, OcppServer, OcppError } from '../src';
import { OcppClient } from '../src/OcppClient';
import { ERROR_NOTSUPPORTED } from '../src/impl/OcppError';

describe('CallError propagation', () => {
  let server: OcppServer;
  let client: OcppClient;

  afterEach(() => {
    client?.close();
    server?.close();
  });

  it('rejects callRequest() with the handler-supplied OcppError as soon as errorCb is called, not after the protocol timeout', async () => {
    // Long protocol timeout on both ends: if the fix regresses to timeout-based
    // propagation, this test times out (Jest's default 5s) instead of passing fast.
    server = new OcppServer(30000);
    server.listen(8081);

    server.on('connection', (cp) => {
      cp.on('BootNotification', (_request, _cb, errorCb) => {
        errorCb(new OcppError(ERROR_NOTSUPPORTED, 'energy management not enabled'));
      });
    });

    client = new OcppClient('CP-ERR-1', 30000);
    client.connect('ws://localhost:8081/');

    await new Promise<void>((resolve) => client.on('connect', resolve));

    const payload: BootNotificationRequest = {
      chargePointModel: 'ModelX',
      chargePointVendor: 'VendorY',
    };

    const start = Date.now();
    await expect(client.callRequest('BootNotification', payload)).rejects.toMatchObject({
      code: ERROR_NOTSUPPORTED,
      info: 'energy management not enabled',
    });
    // Should resolve near-instantly via errorCb, well under the 30s protocolTimeout.
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
