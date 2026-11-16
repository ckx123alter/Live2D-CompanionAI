import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const presentation=source.slice(source.indexOf('async function presentReply('),source.indexOf('function showService()'));
function harness(voice=true) {
  const events=[];
  let callbacks,finish;
  const context=vm.createContext({settings:{voice},waitingReply:true,
    preloadReply:async()=>{},renderMessages:()=>events.push('render'),
    performReply:()=>events.push('pose'),
    speak:(_message,options)=>{callbacks=options;return new Promise(resolve=>{finish=resolve;});},
  });
  vm.runInContext(presentation,context);
  return {events,context,start:()=>callbacks.onReady(),finish:reason=>finish(reason),
    present:()=>context.presentReply({text:'reply'},()=>events.push('text'))};
}
test('text and typing wait for audio start, but do not wait for the audio to end',async()=>{
  const h=harness(), pending=h.present();
  await Promise.resolve();
  assert.deepEqual(h.events,['render']);
  assert.equal(h.context.waitingReply,true);
  h.start();
  const {finished}=await pending;
  assert.deepEqual(h.events,['render','text','render']);
  assert.equal(h.context.waitingReply,false);
  h.start();
  assert.deepEqual(h.events,['render','text','render']);
  h.finish('ended');assert.equal(await finished,'ended');
});
test('cancellation while preparing voice reveals the reply once and clears typing',async()=>{
  const h=harness(),pending=h.present();h.finish('cancelled');
  const {finished}=await pending;
  assert.equal(await finished,'cancelled');
  assert.deepEqual(h.events,['render','text','render','pose']);
  assert.equal(h.context.waitingReply,false);
});
test('voice disabled presents text and pose without requesting audio',async()=>{
  const h=harness(false);const {finished}=await h.present();
  assert.equal(await finished,'ended');
  assert.deepEqual(h.events,['render','text','render','pose']);
});

test('a stalled motion download cannot keep a completed reply waiting forever',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const context=vm.createContext({setTimeout,clearTimeout,expressions:[],normalizeEmotion:x=>x,
    replyAction:()=> 'Wave',model:{internalModel:{motionManager:{loadMotion:()=>new Promise(()=>{})}}}});
  vm.runInContext(source.slice(source.indexOf('function preloadReply('),source.indexOf('async function setExpression(')),context);
  let ready=false;const pending=context.preloadReply({}).then(()=>{ready=true;});
  await Promise.resolve();assert.equal(ready,false);
  t.mock.timers.tick(5000);await pending;assert.equal(ready,true);
});
