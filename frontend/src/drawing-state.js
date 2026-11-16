// Serialize versioned snapshots; retry temporary failures without losing dirty state.
const retryable = error => error.code === 'request_processing' ||
  [0, 408, 425, 429].includes(error.status) || error.status >= 500 ||
  ['AbortError', 'TimeoutError'].includes(error.name);

export function drawingSaveErrorMessage(error) {
  if (error.drawingSynced) return '游戏进度已同步，请重试刚才的操作';
  if (error.status === 401) return '画板未保存：会话已过期或需要登录，请重新连接。';
  if (error.status === 403) return '画板未保存：服务器拒绝访问，请检查访问权限。';
  if ([400, 413, 422].includes(error.status)) return '画板未保存：画板数据不符合要求，请保留当前页面并联系维护者。';
  const reason = error.status === 429 ? '保存过于频繁' :
    error.code === 'request_processing' ? '上一条请求仍在处理' :
    error.status >= 500 ? `服务器暂时异常（HTTP ${error.status}）` :
    error.code === 'request_timeout' || ['AbortError', 'TimeoutError'].includes(error.name) ? '保存请求超时' :
    error.status === 0 ? '网络连接失败' : (error.message || '保存失败');
  return `画板暂未保存：${reason}。${error.drawingWillRetry ? '稍后或网络恢复后自动重试。' : '请稍后再次操作画板重试。'}`;
}

export function createDrawingState({api, snapshot, restore, canSave, onError,
  isOnline = () => globalThis.navigator?.onLine !== false}) {
  let version=0, enabled=false, dirty=false, timer=null, running=null, epoch=0;
  let failures=0, blocked=false, lastNotice='';
  const maxRetries=5;
  const retryDelay=()=>Math.min(30000, 2000 * 2 ** Math.max(0, failures-1));
  function notify(error) {
    const message=drawingSaveErrorMessage(error);
    if(message!==lastNotice){lastNotice=message;onError(error);}
  }
  function arm(delay) {
    clearTimeout(timer);
    timer=setTimeout(()=>{
      timer=null;
      if(!enabled||!dirty||blocked)return;
      if(!isOnline()){
        notify(Object.assign(new Error('离线'),{status:0,drawingWillRetry:true}));
        return;
      }
      if(!canSave()){arm(400);return;}
      flush().catch(notify);
    },delay);
  }
  function schedule() {
    if(!enabled)return;
    dirty=true;
    if(blocked)return;
    // New strokes must not bypass the backoff after a temporary failure.
    if(failures&&failures<=maxRetries){if(timer===null)arm(retryDelay());return;}
    failures=0;arm(400);
  }
  async function flush() {
    clearTimeout(timer);timer=null;
    if(running)await running;
    if(!enabled||!dirty)return;
    const generation=epoch;
    dirty=false;
    running=(async()=>{
      try {
        let result;
        try {
          result=await api('/drawing/state',{method:'PUT',body:{version,state:snapshot()},signal:AbortSignal.timeout(20000)});
        } catch(error) {
          if(generation!==epoch)return;
          if(error.status!==409||error.code==='request_processing')throw error;
          // A failed refresh is a save failure, not a successful synchronization.
          const latest=await api('/drawing/state',{signal:AbortSignal.timeout(20000)});
          if(generation!==epoch)return;
          enabled=false;
          try{await restore(latest.state);version=latest.version;dirty=false;}
          finally{if(generation===epoch)enabled=true;}
          error.drawingSynced=true;
          throw error;
        }
        if(generation!==epoch)return;
        version=result.version;failures=0;blocked=false;lastNotice='';
      } catch(error) {
        if(generation!==epoch)return;
        if(error.drawingSynced){failures=0;blocked=false;}
        else {
          dirty=true;failures++;
          blocked=!retryable(error);
          error.drawingWillRetry=!blocked&&failures<=maxRetries;
          if(error.drawingWillRetry&&isOnline())arm(retryDelay());
        }
        throw error;
      }
    })();
    try{await running;}finally{running=null;}
    if(dirty)await flush();
  }
  async function suspend() {
    epoch++;enabled=false;dirty=false;clearTimeout(timer);timer=null;
    if(running)await running.catch(()=>{});
    failures=0;blocked=false;lastNotice='';
  }
  async function load(data) {
    await suspend();
    version=data?.version||0;
    await restore(data?.state||null);
    enabled=true;
  }
  function retry() {
    if(!enabled||!dirty||blocked)return;
    failures=0;
    arm(0);
  }
  function resume() { enabled=true;schedule(); }
  return {schedule,flush,load,suspend,resume,retry};
}
