// Credentials live only in this document; discard older persisted credentials.
const KEY_STORAGE = 'whale-api-keys';
try { window.sessionStorage.removeItem(KEY_STORAGE); } catch { /* Storage may be disabled. */ }
let userKeys = { llm: '', tts: '' };
export function setUserKeys(llm, tts) {
  userKeys = { llm: llm.trim() || userKeys.llm, tts: tts.trim() || userKeys.tts };
  return true;
}
export function clearUserKeys() {
  userKeys = { llm: '', tts: '' };
  try { window.sessionStorage.removeItem(KEY_STORAGE); return true; }
  catch { return false; }
}
export function keyStatus() { return { llm: Boolean(userKeys.llm), tts: Boolean(userKeys.tts) }; }
// A document restored from the back/forward cache must not revive deleted keys.
window.addEventListener('pagehide', clearUserKeys);
window.addEventListener('pageshow', event => { if (event.persisted) clearUserKeys(); });

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Whale-Client': 'web', ...((path === '/chat' || path === '/drawing/guess') && userKeys.llm ? { 'X-LLM-Key': userKeys.llm } : {}), ...((path === '/tts'||path === '/tts/stream') && userKeys.tts ? { 'X-TTS-Key': userKeys.tts } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(190000),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw new ApiError('请求超时，请稍后重试。', 0, 'request_timeout');
    throw new ApiError('无法连接后端，请检查服务是否启动。', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.code === 'credentials_required') window.dispatchEvent(new Event('credentials-required'));
    throw new ApiError(typeof data.detail === 'string' ? data.detail : `请求失败（HTTP ${response.status}），请稍后重试。`, response.status, data.code);
  }
  if (path === '/tts') return response.status === 204 ? null : response.blob();
  if (path === '/tts/stream') return response;
  const result = await response.json().catch(() => null);
  if (!result) throw new ApiError('后端返回格式错误。', response.status);
  return result;
}
