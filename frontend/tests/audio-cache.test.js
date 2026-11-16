import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioCache} from '../src/audio-cache.js';
test('decoded audio cache evicts least recently used entries within its memory budget',()=>{
  const cache=new AudioCache(16,2),buffer={length:2,numberOfChannels:1};
  cache.put('a',buffer);cache.put('b',buffer);cache.get('a');cache.put('c',buffer);
  assert.equal(cache.get('b'),null);assert.equal(cache.get('a'),buffer);assert.equal(cache.bytes,16);
  cache.put('huge',{length:100,numberOfChannels:2});assert.equal(cache.get('huge'),null);
  cache.clear();assert.equal(cache.bytes,0);assert.equal(cache.get('a'),null);
});
