import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_PATHS, PixEagleObserverClient, PixEagleObserverError } from './observer-client.mjs';

const TOKEN = 'example-only-no-production-credential-0000';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const client = (fetchImpl, overrides = {}) => new PixEagleObserverClient({
  baseUrl: 'http://127.0.0.1:5077', token: TOKEN, fetchImpl, ...overrides,
});

test('only fixed GET endpoints are reachable', async () => {
  const observed = [];
  const c = client(async (url, opts) => {
    observed.push({url, opts});
    return json({status: 'ok'});
  });
  const methods = [c.readRuntime, c.readTelemetryHealth, c.readTrackingStatus,
    c.readTrackingTelemetry, c.readFollowingStatus, c.readFollowingTelemetry,
    c.readMediaHealth];
  for (const method of methods) {
    const observation = await method.call(c);
    assert.equal(observation.associationVerified, false);
  }
  assert.deepEqual(observed.map(item => new URL(item.url).pathname),
    Object.values(OBSERVATION_PATHS));
  for (const entry of observed) {
    assert.equal(new URL(entry.url).origin, 'http://127.0.0.1:5077');
    assert.equal(entry.opts.method, 'GET');
    assert.equal(entry.opts.redirect, 'error');
    assert.equal(entry.opts.credentials, 'omit');
    assert.equal(entry.opts.headers.Authorization, 'Bearer ' + TOKEN);
  }
  assert.equal(c.post, undefined);
  assert.equal(c.request, undefined);
});

test('invalid/insecure origins and weak credentials fail closed', () => {
  for (const baseUrl of [
    'http://remote.example', 'http://localhost:5077', 'ftp://127.0.0.1',
    'http://127.0.0.1:5077/api/v1/actions/offboard-start',
    'http://127.0.0.1:5077/?secret=yes',
    'http://user:pass@127.0.0.1:5077',
  ]) assert.throws(() => client(async () => json({}), {baseUrl}), TypeError);
  assert.throws(() => client(async () => json({}), {token:'weak'}), TypeError);
  assert.doesNotThrow(() => client(async () => json({}), {baseUrl:'https://trusted.example'}));
});

test('bad JSON and non-object payload fail closed', async () => {
  await assert.rejects(client(async () => json([])).readRuntime(),
    error => error.code === 'invalid_payload');
  await assert.rejects(client(async () => new Response('{bad')).readRuntime(),
    error => error.code === 'invalid_json');
});

test('auth denials never echo credentials', async () => {
  await assert.rejects(client(async () => json({token:TOKEN}, 403)).readRuntime(),
    error => error.code === 'unauthorized' && error.httpStatus === 403 &&
      !error.message.includes(TOKEN));
});

test('large bodies are rejected without trusting content-length', async () => {
  await assert.rejects(client(async () => new Response('x'.repeat(1_048_577))).readRuntime(),
    error => error.code === 'response_too_large');
});

test('overview failures are isolated and redacted', async () => {
  const c = client(async url => {
    if (url.endsWith('/api/v1/runtime/status')) return json({status:'ok'});
    throw new Error('network failure may include ' + TOKEN);
  });
  const overview = await c.readOverview();
  assert.equal(overview.runtime.ok, true);
  assert.equal(overview.telemetryHealth.code, 'transport_error');
  assert.ok(!JSON.stringify(overview).includes(TOKEN));
});

test('an aborting deadline yields typed timeout', async () => {
  const c = client((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('aborted')), {once:true});
  }), {timeoutMs:100});
  await assert.rejects(c.readRuntime(),
    error => error instanceof PixEagleObserverError && error.code === 'timeout');
});
