import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('a transient session failure can reconnect without reloading the page', async () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, {hidden: true, disabled: false});
    return elements.get(selector);
  };
  let attempts = 0;
  const context = vm.createContext({$, toast() {}, promptCredentials() {},
    api: async path => {
      if (path === '/config') return {credential_mode: 'server'};
      if (++attempts === 1) throw new Error('temporary failure');
      return {messages: []};
    },
  });
  vm.runInContext(`let backend=null, serviceReady=false;
    function showService() { $('.send').disabled=!serviceReady; }
    async function acceptHistory() { serviceReady=true;showService(); }
    ${source.slice(source.indexOf('let connecting=false;'), source.indexOf('function syncSettings()'))}`, context);
  await vm.runInContext('connectBackend()', context);
  assert.equal($('.send').disabled, true);
  assert.equal($('#reconnect').hidden, false);
  assert.equal($('#reconnect').disabled, false);
  await $('#reconnect').onclick();
  assert.equal($('.send').disabled, false);
  assert.equal($('#reconnect').hidden, true);
  assert.equal(attempts, 2);
});
