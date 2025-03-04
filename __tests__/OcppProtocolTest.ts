import { Protocol } from '../src/impl/Protocol';
import { AuthorizeRequest, AuthorizeResponse, OcppClient, OcppClientConnection, OcppServer } from "../src";
import { Server } from '../src/impl/Server';

describe('OcppProtocol', () => {


  it('test close',async () => {
    const cs = new OcppServer();
    
    cs.on('connection', (client: OcppClientConnection) => {
      console.log('client connection');
      client
      .on("Authorize", (request: AuthorizeRequest, cb: (response: AuthorizeResponse) => void) => {
        console.log('i was here');
        cb({idTagInfo: {status:'Accepted'}})
      })
      .on('error',(err: any) =>{
        console.log('error',err);
      })
      .on('close',()=>{
        console.log('client closed');

      });   
    })

    cs.listen(3000);
    await sleep(50);
    const cp =new OcppClient('testCP');
    cp.connect('ws://localhost:3000/');
    cp.on('connect',async ()=>{
      // await sleep(200);
      // cp.callRequest('Authorize', { idTag: '1234567890' }).then(r => console.log(r));
    })
   
   await sleep(100);
   cp.callRequest('Authorize', { idTag: '1234567890'}).then(r => console.log('after' + r));
   await sleep(1000);
  },6000);
});

export async function sleep(ms: number): Promise<void> {
  return new Promise(
    (resolve) => setTimeout(resolve, ms));
}
