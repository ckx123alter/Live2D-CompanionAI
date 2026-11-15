import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const playAction=source.slice(source.indexOf('function playAction('),source.indexOf('const save ='));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function setup() {
  const manager=new EventEmitter(), loaded=[], played=[], timers=[], clips=new Map();
  manager.stopAllMotions=()=>{};
  manager.loadMotion=async name=>{
    loaded.push(name);
    if(!clips.has(name))clips.set(name,{
      setFadeInTime(value){this.fadeIn=value;},
      setFadeOutTime(value){this.fadeOut=value;},
    });
    return clips.get(name);
  };
  const context=vm.createContext({
    model:{internalModel:{motionManager:manager},motion:async name=>{played.push(name);return true;}},
    performance:{now:()=>1000},headActions:new Set(['Tilt','Nod','Shake']),
    toast:message=>assert.fail(message),syncActions:()=>{},
    setTimeout:callback=>{timers.push(callback);return callback;},
    clearTimeout:timer=>{const index=timers.indexOf(timer);if(index>=0)timers.splice(index,1);},
    actionTimer:null,grassSwayStarted:-Infinity,grassSwayBase:null,actionFinishListener:null,
    actionRevision:0,heldAction:null,activeAction:null,actionStarted:0,actionUntil:0,waveAtChest:false,
  });
  vm.runInContext(playAction,context);
  return {context,manager,loaded,played,clips,timers};
}

test('automatic chest gesture preloads its return and completes without residual fades',async()=>{
  const {context,manager,loaded,played,clips,timers}=setup();
  context.playAction('Wave');await settle();
  assert.deepEqual(loaded,['Wave','Rest']);
  assert.equal(clips.get('Wave').fadeOut,0);
  manager.emit('motionFinish');timers.shift()();await settle();
  assert.deepEqual(played,['Wave','Rest']);
  assert.equal(clips.get('Rest').fadeIn,.12);
  assert.equal(clips.get('Rest').fadeOut,0);
  assert.equal(context.activeAction,'Wave');
  manager.emit('motionFinish');
  assert.equal(context.activeAction,null);
  assert.equal(context.actionUntil,0);
});

test('cancelling a held chest pose plays the return before releasing hand control',async()=>{
  const {context,manager,loaded,played}=setup();
  context.playAction('Wave',true);await settle();
  assert.deepEqual(loaded,['Wave','Rest']);
  manager.emit('motionFinish');
  assert.equal(context.heldAction,'Wave');
  context.playAction('Rest',true);await settle();
  assert.equal(context.heldAction,null);
  assert.equal(context.activeAction,'Wave');
  assert.deepEqual(played,['Wave','Rest']);
  manager.emit('motionFinish');
  assert.equal(context.activeAction,null);
});

test('an interrupted entrance does not jump to the fully raised return pose',async()=>{
  const {context,played}=setup();
  context.playAction('Wave',true);await settle();
  context.playAction('Rest',true);await settle();
  assert.deepEqual(played,['Wave']);
  assert.equal(context.activeAction,null);
});

test('a new action supersedes a pending chest return',async()=>{
  const {context,manager,played}=setup();
  context.playAction('Wave',true);await settle();manager.emit('motionFinish');
  context.playAction('Rest');context.playAction('Tilt',true);await settle();
  assert.deepEqual(played,['Wave']);
  assert.equal(context.activeAction,'Tilt');
  assert.equal(context.heldAction,'Tilt');
});
