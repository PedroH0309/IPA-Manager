(function registerIPASignatureEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IPASignatureEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIPASignatureEngine() {
  'use strict';

  // Diagnostic parser only. These are format details, not a replacement for
  // Apple's Code Signing Services, CMS verification, or iOS trust decisions.
  const MAGIC_MACHO_64 = 0xfeedfacf;
  const MAGIC_MACHO_32 = 0xfeedface;
  const MAGIC_FAT_32 = 0xcafebabe;
  const MAGIC_FAT_64 = 0xcafebabf;
  const MAGIC_SUPERBLOB = 0xfade0cc0;
  const MAGIC_CODEDIRECTORY = 0xfade0c02;
  const MAGIC_CMS = 0xfade0b01;
  const LC_CODE_SIGNATURE = 0x1d;
  const MAX_BINARY_BYTES = 64 * 1024 * 1024;
  const MAX_CODE_PAGES = 8192;
  const HASH_ALGORITHMS = Object.freeze({
    2: { name: 'SHA-256', size: 32 },
    3: { name: 'SHA-256 (truncado)', size: 20 },
    4: { name: 'SHA-384', size: 48 }
  });

  function requireRange(start, size, total, label) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) ||
        start < 0 || size < 0 || start > total || size > total - start) {
      throw new Error('Estrutura de assinatura inválida: ' + label + ' fora dos limites.');
    }
  }

  function viewOf(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('O executável deve ser Uint8Array.');
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function hex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function architectures(bytes) {
    const view = viewOf(bytes);
    requireRange(0, 4, bytes.length, 'cabeçalho Mach-O');
    const big = view.getUint32(0, false);
    const little = view.getUint32(0, true);
    let fatEndian = null;
    let fat64 = false;

    if (big === MAGIC_FAT_32 || big === MAGIC_FAT_64) {
      fatEndian = false;
      fat64 = big === MAGIC_FAT_64;
    } else if (little === MAGIC_FAT_32 || little === MAGIC_FAT_64) {
      fatEndian = true;
      fat64 = little === MAGIC_FAT_64;
    }
    if (fatEndian === null) return [{ offset: 0, size: bytes.length, name: 'Mach-O' }];

    requireRange(0, 8, bytes.length, 'cabeçalho universal');
    const count = view.getUint32(4, fatEndian);
    const recordSize = fat64 ? 32 : 20;
    if (!count || count > 8) throw new Error('Número de arquiteturas Mach-O não suportado.');
    requireRange(8, count * recordSize, bytes.length, 'tabela universal');

    const slices = [];
    for (let index = 0; index < count; index++) {
      const pos = 8 + index * recordSize;
      const cpu = view.getInt32(pos, fatEndian);
      const offset = fat64 ? Number(view.getBigUint64(pos + 8, fatEndian)) : view.getUint32(pos + 8, fatEndian);
      const size = fat64 ? Number(view.getBigUint64(pos + 16, fatEndian)) : view.getUint32(pos + 12, fatEndian);
      requireRange(offset, size, bytes.length, 'arquitetura ' + (index + 1));
      slices.push({ offset, size, name: 'CPU ' + cpu });
    }
    return slices;
  }

  function codeSignatureForSlice(bytes, slice) {
    const view = viewOf(bytes);
    const start = slice.offset;
    requireRange(start, 32, bytes.length, 'cabeçalho de arquitetura');
    const big = view.getUint32(start, false);
    const little = view.getUint32(start, true);
    const is64 = big === MAGIC_MACHO_64 || little === MAGIC_MACHO_64;
    const is32 = big === MAGIC_MACHO_32 || little === MAGIC_MACHO_32;
    if (!is64 && !is32) throw new Error('O executável principal não é Mach-O compatível.');
    const littleEndian = is64 ? little === MAGIC_MACHO_64 : little === MAGIC_MACHO_32;
    const headerSize = is64 ? 32 : 28;
    requireRange(start, headerSize, bytes.length, 'cabeçalho Mach-O');
    const count = view.getUint32(start + 16, littleEndian);
    const commandsSize = view.getUint32(start + 20, littleEndian);
    if (count > 4096 || commandsSize > 16 * 1024 * 1024) {
      throw new Error('Comandos Mach-O excedem o limite de segurança.');
    }
    requireRange(headerSize, commandsSize, slice.size, 'comandos Mach-O');
    let cursor = headerSize;
    let signature = null;
    for (let index = 0; index < count; index++) {
      requireRange(cursor, 8, headerSize + commandsSize, 'comando Mach-O');
      const command = view.getUint32(start + cursor, littleEndian);
      const commandSize = view.getUint32(start + cursor + 4, littleEndian);
      if (commandSize < 8) throw new Error('Comando Mach-O com tamanho inválido.');
      requireRange(cursor, commandSize, headerSize + commandsSize, 'comando Mach-O');
      if (command === LC_CODE_SIGNATURE) {
        if (commandSize < 16 || signature) throw new Error('LC_CODE_SIGNATURE inválido ou duplicado.');
        const offset = view.getUint32(start + cursor + 8, littleEndian);
        const size = view.getUint32(start + cursor + 12, littleEndian);
        requireRange(offset, size, slice.size, 'LC_CODE_SIGNATURE');
        signature = { offset: start + offset, size };
      }
      cursor += commandSize;
    }
    return signature;
  }

  function blobsFromSignature(bytes, signature) {
    const view = viewOf(bytes);
    const start = signature.offset;
    requireRange(start, 12, bytes.length, 'SuperBlob');
    if (view.getUint32(start, false) !== MAGIC_SUPERBLOB) {
      throw new Error('Assinatura Mach-O encontrada, mas o SuperBlob não é reconhecido.');
    }
    const length = view.getUint32(start + 4, false);
    const count = view.getUint32(start + 8, false);
    if (length < 12 || length > signature.size || count > 128) {
      throw new Error('SuperBlob inconsistente.');
    }
    requireRange(12, count * 8, length, 'índice do SuperBlob');
    const blobs = [];
    for (let index = 0; index < count; index++) {
      const pos = start + 12 + index * 8;
      const type = view.getUint32(pos, false);
      const offset = view.getUint32(pos + 4, false);
      requireRange(offset, 8, length, 'sub-bloco da assinatura');
      const magic = view.getUint32(start + offset, false);
      const size = view.getUint32(start + offset + 4, false);
      if (size < 8) throw new Error('Sub-bloco da assinatura com tamanho inválido.');
      requireRange(offset, size, length, 'conteúdo do sub-bloco');
      blobs.push({ type, magic, offset: start + offset, size });
    }
    return blobs;
  }

  async function checkCodeDirectory(bytes, slice, blob, subtle, options) {
    const view = viewOf(bytes);
    const start = blob.offset;
    if (blob.magic !== MAGIC_CODEDIRECTORY || blob.size < 44) {
      throw new Error('CodeDirectory ausente ou inválido.');
    }
    const version = view.getUint32(start + 8, false);
    const hashOffset = view.getUint32(start + 16, false);
    const specialSlots = view.getUint32(start + 24, false);
    const codeSlots = view.getUint32(start + 28, false);
    let codeLimit = view.getUint32(start + 32, false);
    const hashSize = view.getUint8(start + 36);
    const hashType = view.getUint8(start + 37);
    const pageExponent = view.getUint8(start + 39);
    const algorithm = HASH_ALGORITHMS[hashType];
    if (version >= 0x20300 && codeLimit === 0 && blob.size >= 64) {
      codeLimit = Number(view.getBigUint64(start + 56, false));
    }

    const details = {
      hashType, hashAlgorithm: algorithm?.name || 'Tipo ' + hashType,
      codeSlots, codeLimit, checkedSlots: 0, cdhash: null, status: 'unsupported'
    };
    if (!algorithm || algorithm.size !== hashSize) return details;
    if (version >= 0x20100 && blob.size >= 48 && view.getUint32(start + 44, false) !== 0) {
      return details; // Scattered code pages require a different mapping.
    }
    if (!Number.isSafeInteger(codeLimit) || codeLimit > slice.size || !codeSlots) {
      throw new Error('CodeDirectory possui tamanho de código inválido.');
    }
    const pageBytes = pageExponent === 0 ? codeLimit : 2 ** pageExponent;
    if (!Number.isSafeInteger(pageBytes) || pageBytes < 1 || pageBytes > 65536 ||
        Math.ceil(codeLimit / pageBytes) !== codeSlots || codeSlots > 65536) {
      throw new Error('CodeDirectory possui tabela de páginas inconsistente.');
    }
    requireRange(hashOffset, codeSlots * hashSize, blob.size, 'hashes das páginas');
    if (specialSlots > Math.floor(hashOffset / hashSize)) {
      throw new Error('CodeDirectory possui hashes especiais fora dos limites.');
    }
    if (codeSlots > (options.maxPages ?? MAX_CODE_PAGES)) return details;
    if (!subtle || typeof subtle.digest !== 'function') {
      throw new Error('Web Crypto indisponível para verificar as páginas do executável.');
    }

    const algorithmName = hashType === 4 ? 'SHA-384' : 'SHA-256';
    const cdDigest = new Uint8Array(await subtle.digest(algorithmName, bytes.subarray(start, start + blob.size)));
    details.cdhash = hex(cdDigest.subarray(0, 20));
    for (let index = 0; index < codeSlots; index++) {
      const offset = index * pageBytes;
      const end = Math.min(offset + pageBytes, codeLimit);
      const digest = new Uint8Array(await subtle.digest(algorithmName, bytes.subarray(slice.offset + offset, slice.offset + end)));
      const stored = bytes.subarray(start + hashOffset + index * hashSize, start + hashOffset + (index + 1) * hashSize);
      if (stored.some((byte, n) => digest[n] !== byte)) {
        details.checkedSlots = index + 1;
        details.status = 'mismatch';
        return details;
      }
      details.checkedSlots = index + 1;
      if ((index + 1) % 64 === 0 && typeof options.onProgress === 'function') {
        options.onProgress({ checked: index + 1, total: codeSlots });
        // Yield to the mobile browser so the UI remains responsive.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    details.status = 'match';
    return details;
  }

  async function auditExecutable(bytes, options = {}) {
    viewOf(bytes);
    if (!bytes.length || bytes.length > MAX_BINARY_BYTES) {
      throw new Error('Executável fora do limite de 64 MiB para auditoria local.');
    }
    const subtle = options.subtle || (typeof crypto !== 'undefined' ? crypto.subtle : null);
    const results = [];
    for (const slice of architectures(bytes)) {
      const signature = codeSignatureForSlice(bytes, slice);
      if (!signature || !signature.size) {
        results.push({ name: slice.name, status: 'unsigned', cmsPresent: false, codeSlots: 0, checkedSlots: 0 });
        continue;
      }
      const blobs = blobsFromSignature(bytes, signature);
      const primary = blobs.find(blob => blob.type === 0 && blob.magic === MAGIC_CODEDIRECTORY);
      const cmsPresent = blobs.some(blob => blob.type === 0x10000 && blob.magic === MAGIC_CMS && blob.size > 8);
      if (!primary) {
        results.push({ name: slice.name, status: 'unsupported', cmsPresent, codeSlots: 0, checkedSlots: 0 });
        continue;
      }
      const verified = await checkCodeDirectory(bytes, slice, primary, subtle, options);
      results.push({ name: slice.name, cmsPresent, ...verified });
    }
    const statuses = results.map(item => item.status);
    const status = statuses.includes('mismatch') ? 'mismatch' :
      statuses.includes('unsigned') ? 'unsigned' :
      statuses.every(value => value === 'match') ? 'match' : 'unsupported';
    return Object.freeze({ status, architectures: results, cmsPresent: results.every(item => item.cmsPresent) });
  }

  return Object.freeze({
    auditExecutable,
    limits: Object.freeze({ maxBinaryBytes: MAX_BINARY_BYTES, maxCodePages: MAX_CODE_PAGES })
  });
});
