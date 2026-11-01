const assert = require('node:assert/strict');
const test = require('node:test');
const { download, validateDownloadUrl, limits } = require('../download-engine.js');

function zipBytes(content = 'ipa test') {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(content)]);
}

function responseFor(bytes, options = {}) {
  const headers = new Headers(options.headers || { 'content-length': String(bytes.length), 'content-type': 'application/zip' });
  const response = new Response(new Blob([bytes]), { status: options.status || 200, headers });
  if (options.type) Object.defineProperty(response, 'type', { value: options.type });
  if (options.url) Object.defineProperty(response, 'url', { value: options.url });
  return response;
}

test('accepts public HTTPS URLs and removes fragments', () => {
  assert.equal(validateDownloadUrl('https://github.com/example/app/releases/download/v1/app.ipa#asset'), 'https://github.com/example/app/releases/download/v1/app.ipa');
});

test('rejects non-HTTPS, credentials, local hosts, IP literals, and custom ports', () => {
  for (const url of [
    'http://example.com/app.ipa',
    'https://user:pass@example.com/app.ipa',
    'https://localhost/app.ipa',
    'https://service.local/app.ipa',
    'https://127.0.0.1/app.ipa',
    'https://[::1]/app.ipa',
    'https://example.com:8443/app.ipa'
  ]) assert.throws(() => validateDownloadUrl(url));
});

test('downloads a ZIP stream and reports progress', async () => {
  const bytes = zipBytes();
  const progress = [];
  const result = await download('https://downloads.example.com/app.ipa', {
    fetchImpl: async () => responseFor(bytes),
    onProgress: value => progress.push(value)
  });
  assert.equal(result.bytes, bytes.length);
  assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), bytes);
  assert.equal(progress.at(-1).percent, 100);
});

test('rejects a non-ZIP response', async () => {
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    fetchImpl: async () => responseFor(Buffer.from('not an ipa'))
  }), /assinatura ZIP/i);
});

test('rejects an advertised file larger than the configured limit before reading', async () => {
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    maxBytes: 8,
    fetchImpl: async () => responseFor(zipBytes(), { headers: { 'content-length': '999' } })
  }), /excede o limite/i);
});

test('stops a streamed response when the byte limit is exceeded', async () => {
  const oversized = zipBytes('payload longer than the limit');
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    maxBytes: 12,
    fetchImpl: async () => responseFor(oversized, { headers: {} })
  }), /ultrapassou o limite/i);
});

test('rejects a redirect to a non-HTTPS destination', async () => {
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    fetchImpl: async () => responseFor(zipBytes(), { url: 'http://localhost/redirected.ipa' })
  }), /HTTPS/i);
});

test('reports CORS/readability failures without pretending the file was downloaded', async () => {
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    fetchImpl: async () => responseFor(zipBytes(), { type: 'opaque' })
  }), /CORS/i);
});

test('honors an already-aborted request before starting fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(() => download('https://downloads.example.com/app.ipa', {
    signal: controller.signal,
    fetchImpl: async () => { called = true; return responseFor(zipBytes()); }
  }), error => error.name === 'AbortError');
  assert.equal(called, false);
});

test('keeps the mobile download budget capped at 500 MiB', () => {
  assert.equal(limits.maxDownloadBytes, 500 * 1024 * 1024);
  assert.throws(() => validateDownloadUrl('javascript:alert(1)'));
});
