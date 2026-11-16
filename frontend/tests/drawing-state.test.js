import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrawingState, drawingSaveErrorMessage} from '../src/drawing-state.js';

const failure=(status,code)=>Object.assign(new Error('failure'),{status,code});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,api,options={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const errors=[],restored=[];
  let current={ink:1};
  const state=createDrawingState({api,snapshot:()=>current,restore:async value=>{restored.push(value);},
    canSave:()=>true,onError:error=>errors.push(error),...options});
  await state.load({version:0,state:null});
  t.after(()=>state.suspend());
  return {state,errors,restored,draw:value=>{current=value;state.schedule();}};
}
async function tick(t,ms){t.mock.timers.tick(ms);await settle();}

test('temporary save failure retries without another stroke and uses newest drawing',async t=>{
  const calls=[];
  const h=await setup(t,async(_path,options)=>{
    calls.push(options.body);if(calls.length===1)throw failure(503);
    return {version:1};
  });
  h.draw({ink:1});await tick(t,400);
  h.draw({ink:2});await tick(t,1999);assert.equal(calls.length,1);
  await tick(t,1);assert.equal(calls.length,2);
  assert.deepEqual(calls[1],{version:0,state:{ink:2}});
  await tick(t,60000);assert.equal(calls.length,2);
  assert.equal(h.errors[0].drawingWillRetry,true);
});

test('offline drawing saves when network recovery retries it',async t=>{
  let online=false,calls=0;
  const h=await setup(t,async()=>{calls++;return {version:1};},{isOnline:()=>online});
  h.draw({ink:1});await tick(t,400);assert.equal(calls,0);
  assert.match(drawingSaveErrorMessage(h.errors[0]),/网络/);
  online=true;h.state.retry();await tick(t,0);assert.equal(calls,1);
});

test('automatic retries stop after five retries and do not repeat identical notices',async t=>{
  let calls=0;
  const h=await setup(t,async()=>{calls++;throw failure(429);});
  h.draw({});await tick(t,400);
  for(const delay of [2000,4000,8000,16000,30000])await tick(t,delay);
  assert.equal(calls,6);
  await tick(t,120000);assert.equal(calls,6);
  assert.equal(h.errors.length,2);
  assert.equal(h.errors.at(-1).drawingWillRetry,false);
});

test('session expiry stops background saves until state is reloaded',async t=>{
  let calls=0;
  const h=await setup(t,async()=>{calls++;throw failure(401);});
  h.draw({});await tick(t,400);h.state.retry();h.draw({ink:2});
  await tick(t,120000);assert.equal(calls,1);
  assert.match(drawingSaveErrorMessage(h.errors[0]),/会话已过期/);
});

test('failed conflict refresh preserves dirty state and never claims synchronization',async t=>{
  let calls=0;
  const h=await setup(t,async(_path,options)=>{
    calls++;if(calls===1)throw failure(409);
    if(calls===2)throw failure(503);
    return {version:1};
  });
  h.draw({});await tick(t,400);
  assert.equal(h.restored.length,1);
  assert.equal(h.errors[0].status,503);
  assert.doesNotMatch(drawingSaveErrorMessage(h.errors[0]),/已同步/);
  await tick(t,2000);assert.equal(calls,3);
});

test('actual version conflict restores server state and updates next save version',async t=>{
  const calls=[];
  const h=await setup(t,async(_path,options)=>{
    calls.push(options);
    if(calls.length===1)throw failure(409);
    if(calls.length===2)return {version:4,state:{server:true}};
    return {version:5};
  });
  h.draw({});await tick(t,400);
  assert.deepEqual(h.restored.at(-1),{server:true});
  assert.equal(h.errors[0].drawingSynced,true);
  h.draw({ink:2});await tick(t,400);assert.equal(calls[2].body.version,4);
});

test('busy request is retried without restoring an old snapshot',async t=>{
  let calls=0;
  const h=await setup(t,async()=>{if(++calls===1)throw failure(409,'request_processing');return {version:1};});
  h.draw({});await tick(t,400);await tick(t,2000);
  assert.equal(calls,2);assert.equal(h.restored.length,1);
});

test('clearing while a failed save is in flight prevents old retries and restores',async t=>{
  let reject,calls=0;
  const h=await setup(t,()=>{calls++;return new Promise((_resolve,no)=>{reject=no;});});
  h.draw({ink:1});await tick(t,400);
  const clearing=h.state.suspend();reject(failure(409));await clearing;await settle();
  await h.state.load({version:8,state:null});await tick(t,60000);
  assert.equal(calls,1);assert.equal(h.errors.length,0);
  assert.equal(h.restored.at(-1),null);
});

test('error messages distinguish server, rate, validation, and timeout failures',()=>{
  assert.match(drawingSaveErrorMessage(failure(503)),/HTTP 503/);
  assert.match(drawingSaveErrorMessage(failure(429)),/过于频繁/);
  assert.match(drawingSaveErrorMessage(failure(422)),/数据不符合要求/);
  assert.match(drawingSaveErrorMessage(new DOMException('timeout','TimeoutError')),/超时/);
  assert.match(drawingSaveErrorMessage(failure(0,'request_timeout')),/超时/);
});
