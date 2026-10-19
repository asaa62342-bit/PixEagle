/**
 * Optional PixEagle observer for a trusted Node/Electron main process.
 * GET-only allowlist; no flight, tracking, camera, model or config commands.
 */
export const OBSERVATION_PATHS = Object.freeze({
  runtime: '/api/v1/runtime/status',
  telemetryHealth: '/api/v1/telemetry/health',
  trackingStatus: '/api/v1/tracking/runtime-status',
  trackingTelemetry: '/api/v1/tracking/telemetry',
  followingStatus: '/api/v1/following/status',
  followingTelemetry: '/api/v1/following/telemetry',
  mediaHealth: '/api/v1/streams/media-health',
});
const MAX_BYTES = 1_048_576;

export class PixEagleObserverError extends Error {
  constructor(code, message, httpStatus = null) {
    super(message);
    this.name = 'PixEagleObserverError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function validateOrigin(baseUrl) {
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new TypeError('baseUrl must be an absolute URL'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('Use an origin with no path, credentials, query or fragment');
  }
  if (url.protocol === 'http:') {
    if (!['127.0.0.1', '[::1]'].includes(url.hostname))
      throw new TypeError('Plain HTTP requires a numeric loopback host');
  } else if (url.protocol !== 'https:') {
    throw new TypeError('Only HTTPS or numeric-loopback HTTP is accepted');
  }
  return url.origin;
}

async function boundedObject(response) {
  const announced = response.headers.get('content-length');
  if (announced !== null && Number(announced) > MAX_BYTES)
    throw new PixEagleObserverError('response_too_large', 'Response exceeds limit');
  if (!response.body)
    throw new PixEagleObserverError('invalid_payload', 'Missing JSON response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES)
        throw new PixEagleObserverError('response_too_large', 'Response exceeds limit');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new PixEagleObserverError('invalid_json', 'Invalid JSON response'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new PixEagleObserverError('invalid_payload', 'Expected a JSON object');
  return parsed;
}

export class PixEagleObserverClient {
  #origin;
  #token;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, token, timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
    this.#origin = validateOrigin(baseUrl);
    if (typeof token !== 'string' || token.trim().length < 16 || /\s/.test(token))
      throw new TypeError('A dedicated high-entropy machine bearer token is required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
      throw new TypeError('timeoutMs must be 100–60000');
    if (typeof fetchImpl !== 'function')
      throw new TypeError('fetchImpl must be a function');
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async #read(key) {
    const path = OBSERVATION_PATHS[key];
    if (!path) throw new TypeError('Unknown observation');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#origin + path, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + this.#token,
        },
        signal: controller.signal,
      });
      if ([401, 403].includes(response.status))
        throw new PixEagleObserverError('unauthorized', 'Observation denied', response.status);
      if (!response.ok)
        throw new PixEagleObserverError('remote_error', 'Observation failed', response.status);
      const payload = await boundedObject(response);
      return Object.freeze({
        source: 'pixeagle',
        observation: key,
        observedAt: new Date().toISOString(),
        // Receipt time is not frame freshness or vehicle identity proof.
        associationVerified: false,
        payload,
      });
    } catch (error) {
      if (error instanceof PixEagleObserverError) throw error;
      if (controller.signal.aborted)
        throw new PixEagleObserverError('timeout', 'Observation timed out');
      // Never leak raw network error contents, URLs, or credentials.
      throw new PixEagleObserverError('transport_error', 'Observation transport failed');
    } finally { clearTimeout(timer); }
  }

  readRuntime() { return this.#read('runtime'); }
  readTelemetryHealth() { return this.#read('telemetryHealth'); }
  readTrackingStatus() { return this.#read('trackingStatus'); }
  readTrackingTelemetry() { return this.#read('trackingTelemetry'); }
  readFollowingStatus() { return this.#read('followingStatus'); }
  readFollowingTelemetry() { return this.#read('followingTelemetry'); }
  readMediaHealth() { return this.#read('mediaHealth'); }

  async readOverview() {
    const names = ['runtime', 'telemetryHealth', 'trackingStatus', 'mediaHealth'];
    const results = await Promise.allSettled(names.map(name => this.#read(name)));
    return Object.fromEntries(results.map((result, index) => [
      names[index],
      result.status === 'fulfilled'
        ? { ok: true, observation: result.value }
        : { ok: false, code: result.reason?.code || 'observation_failed' },
    ]));
  }
}
