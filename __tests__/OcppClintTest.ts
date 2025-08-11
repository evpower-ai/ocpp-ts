import { Protocol } from '../src/impl/Protocol';
import { BootNotificationRequest, OcppServer } from "../src";
import { Server } from '../src/impl/Server';
import { OcppClient } from '../src/OcppClient';
describe('OcppClint test', () => {
  it('should reject when charging point is not connected', () => {
    const client = new OcppClient('CP1234');
    const payload :BootNotificationRequest= {
        chargePointModel: 'ModelX',
        chargePointVendor: 'VendorY',   
    };
    return client.callRequest('BootNotification', payload).catch((error) => {
      expect(error).toBe('Charging point not connected to central system');
    });
  });

});
