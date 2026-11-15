import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleLook } from '../src/idle-look.js';

test('third uninterrupted look adds surprise, then holds a lean after finishing', () => {
  const idle=createIdleLook(0);
  assert.equal(idle.sample(4999),null);
  assert.equal(idle.sample(5000).round,1);
  assert.equal(idle.sample(5000).surprise,false);
  assert.equal(idle.sample(17000),null);
  assert.equal(idle.sample(21999),null);
  assert.equal(idle.sample(22000).round,2);
  assert.equal(idle.sample(22000).surprise,false);
  assert.equal(idle.sample(34000),null);
  assert.equal(idle.sample(38999),null);
  const third=idle.sample(40000);
  assert.equal(third.round,3);
  assert.equal(third.surprise,true);
  assert.equal(third.lean,false);
  assert.notEqual(third.x,0);
  assert.equal(idle.sample(50999).lean,false);
  const held=idle.sample(51000);
  assert.equal(held.surprise,true);
  assert.equal(held.lean,true);
  assert.equal(held.holding,true);
  assert.equal(held.x,0);
  assert.deepEqual(idle.sample(600000),held);
});

test('user activity cancels the hold and restarts the consecutive count', () => {
  const idle=createIdleLook(0);
  assert.equal(idle.sample(67000).holding,true);
  idle.reset(68000);
  assert.equal(idle.sample(72999),null);
  assert.equal(idle.sample(73000).round,1);
  assert.equal(idle.sample(73000).surprise,false);
  idle.reset(80000);
  assert.equal(idle.sample(85000).round,1);
  assert.equal(idle.sample(102000).round,2);
  assert.equal(idle.sample(119000).surprise,true);
  assert.equal(idle.sample(119000).lean,false);
});

test('speech, actions, and hidden-page blocking break the idle sequence', () => {
  const idle=createIdleLook(0);
  assert.equal(idle.sample(39000).surprise,true);
  assert.equal(idle.sample(40000,true),null);
  assert.equal(idle.sample(44999),null);
  assert.equal(idle.sample(45000).round,1);
  assert.equal(idle.sample(45000).lean,false);
});
