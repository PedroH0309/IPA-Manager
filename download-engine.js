(function registerIPADownloadEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IPADownloadEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIPADownloadEngine() {
  'use strict';

  const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
  const ZIP_SIGNATURES = [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08]
  ];

  function validateDownloadUrl(value) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      throw new Error('URL de download inválida.');
    }

    if (url.protocol !== 'https:') {
      throw new Error('Downloads remotos exigem uma URL HTTPS.');
    }
    if (url.username || url.password) {
      throw new Error('URLs com usuário ou senha embutidos não são permitidas.');
    }
    if (url.port && url.port !== '443') {
      throw new Error('A URL usa uma porta não padrão, bloqueada por segurança.');
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    const isIPv6 = hostname.startsWith('[') || hostname.includes(':');
    const isLocalName = hostname === 'localhost' ||
      /\.(?:localhost|local|internal|test|invalid)$/.test(hostname);

    if (!hostname || !hostname.includes('.') || isIPv4 || isIPv6 || isLocalName) {
      throw new Error('A URL precisa apontar para um domínio público, não para um endereço local ou IP.');
    }

    url.hash = '';
    return url.href;
  }

  function abortError() {
    if (typeof DOMException === 'function') return new DOMException('Download cancelado.', 'AbortError');
    const error = new Error('Download cancelado.');
    error.name = 'AbortError';
    return error;
  }

  function hasZipSignature(bytes) {
    return ZIP_SIGNATURES.some(signature => signature.every((byte, index) => bytes[index] === byte));
  }

  async function download(url, options = {}) {
    const safeUrl = validateDownloadUrl(url);
    const maxBytes = options.maxBytes === undefined ? MAX_DOWNLOAD_BYTES : options.maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > MAX_DOWNLOAD_BYTES) {
      throw new Error('O limite de download solicitado é inválido ou excede 500 MiB.');
    }

    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error('A API Fetch não está disponível neste navegador.');
    if (options.signal?.aborted) throw abortError();

    const response = await fetchImpl(safeUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/octet-stream, application/zip, */*' },
      signal: options.signal
    });

    if (!response || !response.ok) {
      const status = response && Number.isInteger(response.status) ? response.status : 'desconhecido';
      throw new Error('O servidor recusou o download (HTTP ' + status + ').');
    }
    if (response.type === 'opaque' || !response.body || typeof response.body.getReader !== 'function') {
      throw new Error('O servidor não permite leitura pelo navegador (CORS). Use o link de download direto.');
    }

    const finalUrl = validateDownloadUrl(response.url || safeUrl);
    const lengthHeader = response.headers?.get?.('content-length') || '';
    const contentLength = /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > maxBytes)) {
      throw new Error('O arquivo anunciado excede o limite de ' + Math.round(maxBytes / 1024 / 1024) + ' MiB.');
    }

    const reader = response.body.getReader();
    const chunks = [];
    const signature = [];
    let receivedBytes = 0;

    try {
      while (true) {
        if (options.signal?.aborted) throw abortError();
        const result = await reader.read();
        if (result.done) break;
        if (!result.value) continue;

        const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          throw new Error('O download ultrapassou o limite de ' + Math.round(maxBytes / 1024 / 1024) + ' MiB e foi interrompido.');
        }

        for (let index = 0; index < chunk.length && signature.length < 4; index++) {
          signature.push(chunk[index]);
        }
        chunks.push(chunk);
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            loaded: receivedBytes,
            total: contentLength,
            percent: contentLength ? Math.min(100, (receivedBytes / contentLength) * 100) : null
          });
        }
      }
    } catch (error) {
      try { await reader.cancel(error); } catch { /* The stream may already be closed. */ }
      throw error;
    } finally {
      try { reader.releaseLock(); } catch { /* Ignore already released readers. */ }
    }

    if (receivedBytes < 4 || !hasZipSignature(signature)) {
      throw new Error('O conteúdo recebido não possui uma assinatura ZIP reconhecida. O download foi descartado.');
    }

    const blob = new Blob(chunks, { type: 'application/zip' });
    if (blob.size !== receivedBytes) throw new Error('O tamanho do arquivo recebido não confere.');
    if (typeof options.onProgress === 'function') {
      options.onProgress({ loaded: receivedBytes, total: contentLength, percent: 100 });
    }

    return Object.freeze({
      blob,
      bytes: receivedBytes,
      contentLength,
      contentType: response.headers?.get?.('content-type') || '',
      url: finalUrl
    });
  }

  return Object.freeze({
    download,
    validateDownloadUrl,
    limits: Object.freeze({ maxDownloadBytes: MAX_DOWNLOAD_BYTES })
  });
});
