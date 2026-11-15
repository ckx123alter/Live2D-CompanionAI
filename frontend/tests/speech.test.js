import test from 'node:test';
import assert from 'node:assert/strict';

let prompts = 0;
globalThis.window = {
  addEventListener() {},
  dispatchEvent() { prompts++; },
  speechSynthesis: { cancel() {}, speak() { throw new Error('Device voice must not be used'); } },
};
const { SpeechPlayer } = await import('../src/speech.js');

test('optional TTS without audio completes poses and game flow without alerts or device voice', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const lifecycle = [], errors = [], speaking = [];
  const player = new SpeechPlayer({ onSpeaking: value => speaking.push(value), onError: error => errors.push(error) });
  await player.play({ id: 12, text: '文字回复' }, {
    server: true, volume: .7,
    onStart: () => lifecycle.push('pose'),
    onFinish: reason => lifecycle.push(reason),
    onEnd: () => lifecycle.push('end'),
  });
  assert.deepEqual(lifecycle, ['pose', 'ended', 'end']);
  assert.deepEqual(errors, []);
  assert.equal(prompts, 0);
  assert.ok(speaking.every(value => value === false));
  assert.equal(player.audio, null);
});
