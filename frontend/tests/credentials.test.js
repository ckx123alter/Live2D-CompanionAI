import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
const session = new Map();
globalThis.window = {
  sessionStorage: {
    getItem(key) { return session.get(key) ?? null; },
    setItem(key, value) { session.set(key, value); },
    removeItem(key) { session.delete(key); },
  },
  addEventListener(name, fn) { listeners.set(name, fn); },
  dispatchEvent(event) { listeners.get(event.type)?.(); },
};
const { api, setUserKeys, clearUserKeys, keyStatus } = await import('../src/api.js');

test('credentials stay scoped to the intended API and can be removed', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return new Response(url.endsWith('/tts') ? 'audio' : '{}', { status: 200 });
  };
  setUserKeys('private-llm', 'private-tts');
  await api('/config');
  await api('/chat', { method: 'POST', body: { text: 'hello' } });
  await api('/drawing/guess', { method: 'POST', body: {} });
  await api('/tts', { method: 'POST', body: { preset: 'welcome' } });
  assert.equal(requests[0].headers['X-LLM-Key'], undefined);
  assert.equal(requests[0].headers['X-TTS-Key'], undefined);
  assert.equal(requests[1].headers['X-LLM-Key'], 'private-llm');
  assert.equal(requests[1].headers['X-TTS-Key'], undefined);
  assert.equal(requests[2].headers['X-LLM-Key'], 'private-llm');
  assert.equal(requests[3].headers['X-TTS-Key'], 'private-tts');
  assert.equal(requests[3].headers['X-LLM-Key'], undefined);
  await api('/drawing/round', { method: 'POST', body: { request_id: 'round' } });
  assert.equal(requests[4].headers['X-LLM-Key'], undefined);
  assert.equal(requests[4].headers['X-TTS-Key'], undefined);
  assert.ok(requests.every(r => !r.url.includes('private-') && !r.body?.includes('private-')));
  setUserKeys('', 'replacement');
  assert.deepEqual(keyStatus(), { llm: true, tts: true });
  clearUserKeys();
  assert.deepEqual(keyStatus(), { llm: false, tts: false });
  await api('/chat');
  assert.equal(requests.at(-1).headers['X-LLM-Key'], undefined);
  assert.equal(session.has('whale-api-keys'), false);
});

test('keys are not persisted, reload removes legacy keys, and pagehide clears memory', async () => {
  setUserKeys('memory-llm', 'memory-tts');
  assert.equal(session.size, 0);
  session.set('whale-api-keys', JSON.stringify({llm:'legacy-secret'}));
  const reloaded = await import('../src/api.js?reload');
  assert.deepEqual(reloaded.keyStatus(), {llm:false,tts:false});
  assert.equal(session.size, 0);
  reloaded.setUserKeys('new-key', '');
  listeners.get('pagehide')();
  assert.deepEqual(reloaded.keyStatus(), {llm:false,tts:false});
  clearUserKeys();
});

test('missing credentials request the key dialog and retain structured error code', async () => {
  let shown = false;
  listeners.set('credentials-required', () => { shown = true; });
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'missing', code: 'credentials_required' }), { status: 428 });
  await assert.rejects(api('/chat'), error => error.status === 428 && error.code === 'credentials_required');
  assert.equal(shown, true);
});
