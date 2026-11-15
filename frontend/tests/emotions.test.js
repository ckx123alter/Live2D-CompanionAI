import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emotionIds,legacyEmotions,normalizeEmotion} from '../src/emotions.js';
import {quickReplies} from '../src/quick-replies.js';

test('legacy replies retain their original expression without ambiguous ID reuse',()=>{
  for(const [old,id] of Object.entries(legacyEmotions)){
    assert.equal(normalizeEmotion(old),id);
    assert.equal(normalizeEmotion(id),id);
    assert.ok(!emotionIds.includes(old));
  }
  assert.equal(normalizeEmotion('sad'),'aggrieved');
  assert.equal(normalizeEmotion('sleepy'),'sadness');
  for(const invalid of [undefined,null,{},'__proto__','unknown'])assert.equal(normalizeEmotion(invalid),'neutral');
});

test('cards, frontend IDs, backend whitelist and prompt cover the same 16 expressions',()=>{
  const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const block=source.split('const expressions = [')[1].split('\n];')[0];
  const cards=[...block.matchAll(/\['([^']+)','[^']+','([^']+)'/g)];
  const contracts=readFileSync(new URL('../../backend/contracts.py',import.meta.url),'utf8');
  const backend=JSON.parse(`[${contracts.split('Emotion = Literal[')[1].split(']')[0]}]`);
  assert.equal(cards.length,16);
  assert.deepEqual(cards.map(match=>match[1]).sort(),[...emotionIds].sort());
  assert.deepEqual(backend.sort(),[...emotionIds].sort());
  const prompt=readFileSync(new URL('../../backend/providers.py',import.meta.url),'utf8');
  for(const [,id,label] of cards)assert.ok(prompt.includes(`${id}=${label}`));
  for(const reply of Object.values(quickReplies))assert.ok(emotionIds.includes(reply.emotion));
  assert.equal(quickReplies['没token了怎么办'].emotion,'aggrieved');
  assert.equal(quickReplies['答对了！'].emotion,'curious');
});
