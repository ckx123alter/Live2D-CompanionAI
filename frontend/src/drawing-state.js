// Serialized, versioned snapshots. Chat requests flush first so the server sees
// the same drawing node the user sees; stale tabs cannot overwrite newer work.
export function createDrawingState({api, snapshot, restore, canSave, onError}) {
  let version=0, enabled=false, dirty=false, timer=null, running=null;
  function schedule() {
    if(!enabled)return;
    dirty=true;clearTimeout(timer);
    timer=setTimeout(()=>{if(canSave())flush().catch(onError);else schedule();},400);
  }
  async function flush() {
    clearTimeout(timer);
    if(running)await running;
    if(!enabled||!dirty)return;
    dirty=false;
    running=(async()=>{
      try {
        const result=await api('/drawing/state',{method:'PUT',body:{version,state:snapshot()}});
        version=result.version;
      } catch(error) {
        if(error.status===409){
          enabled=false;
          try{const latest=await api('/drawing/state');version=latest.version;dirty=false;await restore(latest.state);}
          finally{enabled=true;}
        } else dirty=true;
        throw error;
      }
    })();
    try{await running;}finally{running=null;}
    if(dirty)await flush();
  }
  async function load(data) {
    clearTimeout(timer);enabled=false;
    if(running)await running.catch(()=>{});
    version=data?.version||0;dirty=false;
    await restore(data?.state||null);
    enabled=true;
  }
  async function suspend() {
    enabled=false;dirty=false;clearTimeout(timer);
    if(running)await running.catch(()=>{});
    enabled=false;dirty=false;clearTimeout(timer);
  }
  function resume() { enabled=true;schedule(); }
  return {schedule,flush,load,suspend,resume};
}
