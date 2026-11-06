import { snapshotDelta } from '../shared/state-events.js';

export class StateEvents {
  constructor(store) {
    this.store=store;this.clients=new Map();this.snapshot=null;this.revision=0;this.timer=null;this.closed=false;
    this.changed=()=>{if(!this.clients.size){this.snapshot=null;return;}if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.flush();},100);};
    store.on('change',this.changed);
  }
  write(response,event) {
    // A stalled renderer reconnects to a complete snapshot instead of allowing
    // unlimited queued snapshots to consume the server's memory.
    if(response.writableLength>8*1024*1024){response.end();return;}
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  flush() {
    const next=this.store.publicSnapshot();
    if(this.snapshot) {
      const patch=snapshotDelta(this.snapshot,next);
      if(Object.keys(patch.set).length || Object.keys(patch.collections).length || patch.removed.length) {
        const event={type:'delta',base:this.revision,revision:++this.revision,patch};
        for(const [response,client] of this.clients)this.write(response,client.delta?event:next);
      }
    } else this.revision++;
    this.snapshot=next;
  }
  subscribe(req,res) {
    if(this.closed){res.writeHead(503,{'Retry-After':'1'});res.end();return;}
    this.flush();
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
    const delta=req.query.delta==='1';
    this.write(res,delta?{type:'snapshot',revision:this.revision,data:this.snapshot}:this.snapshot);
    const timer=setInterval(()=>res.write(': heartbeat\n\n'),20000);
    this.clients.set(res,{delta,timer});
    req.on('close',()=>{clearInterval(timer);this.clients.delete(res);if(!this.clients.size)this.snapshot=null;});
  }
  close() {
    this.closed=true;
    clearTimeout(this.timer);this.store.off('change',this.changed);
    for(const [response,client] of this.clients){clearInterval(client.timer);response.end();}
    this.clients.clear();this.snapshot=null;
  }
}
