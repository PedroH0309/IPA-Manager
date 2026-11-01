(function registerIPAZipEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IPAZipEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIPAZipEngine() {
  'use strict';

  const MAX_ENTRY_READ_BYTES = 250 * 1024 * 1024;
  const MAX_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
  const MAX_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024;
  const MAX_ENTRIES = 120000;
  const SUSPICIOUS_RATIO_THRESHOLD = 1000;
  const SUSPICIOUS_RATIO_MIN_BYTES = 64 * 1024 * 1024;

  const SIGNATURE = Object.freeze({ eocd: 0x06054b50, central: 0x02014b50, local: 0x04034b50 });

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function crcHex(value) {
    return (value >>> 0).toString(16).padStart(8, '0');
  }

  function validateArchivePath(name) {
    if (typeof name !== 'string' || !name || name.includes('\0')) {
      throw new Error('O arquivo ZIP contém um caminho vazio ou inválido.');
    }
    if (name.startsWith('/') || name.startsWith('\\') || /^[a-z]:/i.test(name) || name.includes('\\')) {
      throw new Error('O arquivo ZIP contém um caminho absoluto ou com separador inválido.');
    }
    const path = name.endsWith('/') ? name.slice(0, -1) : name;
    const segments = path.split('/');
    if (!path || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error('O arquivo ZIP contém um caminho inseguro ou ambíguo.');
    }
    return name;
  }

  function isUnsupportedEncryption(flags) {
    return Boolean(flags & (0x0001 | 0x0040 | 0x2000));
  }

  async function readBoundedStream(stream, expectedSize, maxBytes) {
    if (!stream || typeof stream.getReader !== 'function') {
      throw new Error('O navegador não disponibilizou um fluxo de descompressão válido.');
    }
    const reader = stream.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes || totalBytes > expectedSize) {
          try { await reader.cancel('Limite de descompressão excedido.'); } catch {}
          throw new Error('A saída descompactada excedeu o tamanho declarado ou o limite de segurança. Possível ZIP bomb.');
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    if (totalBytes !== expectedSize) {
      throw new Error('Tamanho descompactado não corresponde ao declarado no diretório ZIP.');
    }
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  const ZIP = {
    async directory(file) {
      if (!(file instanceof Blob)) throw new Error('Arquivo inválido.');
      if (file.size < 22) throw new Error('Arquivo muito pequeno para conter um diretório ZIP.');

      const tailSize = Math.min(file.size, 22 + 65535 + 20);
      const tailStart = file.size - tailSize;
      const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
      const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      let eocdOffset = -1;

      for (let index = tail.length - 22; index >= 0; index -= 1) {
        if (tailView.getUint32(index, true) !== SIGNATURE.eocd) continue;
        const commentLength = tailView.getUint16(index + 20, true);
        if (index + 22 + commentLength === tail.length) {
          eocdOffset = index;
          break;
        }
      }
      if (eocdOffset < 0) {
        throw new Error('Estrutura ZIP inválida: registro final não encontrado ou comentário truncado.');
      }

      const absoluteEocdOffset = tailStart + eocdOffset;
      const diskNumber = tailView.getUint16(eocdOffset + 4, true);
      const centralDisk = tailView.getUint16(eocdOffset + 6, true);
      const entriesOnDisk = tailView.getUint16(eocdOffset + 8, true);
      const entryCount = tailView.getUint16(eocdOffset + 10, true);
      const centralSize = tailView.getUint32(eocdOffset + 12, true);
      const centralOffset = tailView.getUint32(eocdOffset + 16, true);

      if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
        throw new Error('Arquivos ZIP divididos em múltiplos volumes não são suportados.');
      }
      if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error('Este IPA usa ZIP64, ainda não suportado.');
      }
      if (entryCount > MAX_ENTRIES || centralSize > MAX_CENTRAL_DIRECTORY_BYTES) {
        throw new Error('Diretório ZIP excede os limites de inspeção. Análise bloqueada por segurança.');
      }
      if (centralOffset + centralSize > absoluteEocdOffset || centralOffset + centralSize > file.size) {
        throw new Error('Índice ZIP aponta para fora da área permitida do arquivo.');
      }

      const centralBytes = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
      const centralView = new DataView(centralBytes.buffer, centralBytes.byteOffset, centralBytes.byteLength);
      const entries = [];
      const seenPaths = new Set();
      let offset = 0;
      let totalUncompressedBytes = 0;

      for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > centralBytes.length || centralView.getUint32(offset, true) !== SIGNATURE.central) {
          throw new Error('Diretório ZIP corrompido na entrada ' + (index + 1) + '.');
        }
        const versionMadeBy = centralView.getUint16(offset + 4, true);
        const versionNeeded = centralView.getUint16(offset + 6, true);
        const flags = centralView.getUint16(offset + 8, true);
        const method = centralView.getUint16(offset + 10, true);
        const modTime = centralView.getUint16(offset + 12, true);
        const modDate = centralView.getUint16(offset + 14, true);
        const crc = centralView.getUint32(offset + 16, true);
        const compressedSize = centralView.getUint32(offset + 20, true);
        const size = centralView.getUint32(offset + 24, true);
        const nameLength = centralView.getUint16(offset + 28, true);
        const extraLength = centralView.getUint16(offset + 30, true);
        const commentLength = centralView.getUint16(offset + 32, true);
        const diskStart = centralView.getUint16(offset + 34, true);
        const internalAttrs = centralView.getUint16(offset + 36, true);
        const externalAttrs = centralView.getUint32(offset + 38, true);
        const localOffset = centralView.getUint32(offset + 42, true);
        const recordEnd = offset + 46 + nameLength + extraLength + commentLength;

        if (recordEnd > centralBytes.length) throw new Error('Metadados de uma entrada ZIP estão truncados.');
        if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || diskStart !== 0) {
          throw new Error('Entrada ZIP64 ou multi-volume não suportada.');
        }
        if (isUnsupportedEncryption(flags)) throw new Error('O IPA contém uma entrada criptografada ou com cabeçalhos mascarados.');
        if (![0, 8].includes(method)) throw new Error('Método de compressão ZIP ' + method + ' não suportado.');
        if (localOffset >= centralOffset) throw new Error('Uma entrada ZIP aponta para dentro do diretório central.');

        totalUncompressedBytes += size;
        if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error('O tamanho total descompactado excede o limite de segurança de 2 GiB.');
        }
        if (size >= SUSPICIOUS_RATIO_MIN_BYTES &&
            (compressedSize === 0 || size / compressedSize > SUSPICIOUS_RATIO_THRESHOLD)) {
          throw new Error('Uma entrada possui taxa de expansão suspeita. Possível ZIP bomb.');
        }

        const nameBytes = centralBytes.subarray(offset + 46, offset + 46 + nameLength);
        let name;
        if (flags & 0x0800) {
          try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); }
          catch { throw new Error('Uma entrada ZIP contém um nome UTF-8 inválido.'); }
        } else {
          try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); }
          catch { name = new TextDecoder('windows-1252').decode(nameBytes); }
        }

        validateArchivePath(name);
        const duplicateKey = name.toLowerCase();
        if (seenPaths.has(duplicateKey)) {
          throw new Error('O diretório ZIP contém caminhos duplicados ou equivalentes: ' + name);
        }
        seenPaths.add(duplicateKey);

        entries.push({
          name,
          nameBytes: new Uint8Array(nameBytes),
          versionMadeBy,
          versionNeeded,
          flags,
          method,
          modTime,
          modDate,
          internalAttrs,
          externalAttrs,
          crc,
          compressedSize,
          size,
          localOffset,
          centralOffset,
          directory: name.endsWith('/')
        });
        offset = recordEnd;
      }

      if (!entries.length) throw new Error('O arquivo ZIP não contém entradas.');
      return entries;
    },

    async read(file, entry, options) {
      if (!(file instanceof Blob) || !entry || typeof entry !== 'object') {
        throw new Error('Arquivo ou entrada ZIP inválida.');
      }
      if (entry.directory) return new Uint8Array();
      if (isUnsupportedEncryption(entry.flags || 0)) {
        throw new Error('A entrada está criptografada ou possui cabeçalhos protegidos.');
      }
      if (![0, 8].includes(entry.method)) throw new Error('Método de compressão não suportado.');

      const maxOutputBytes = options && Number.isSafeInteger(options.maxOutputBytes)
        ? Math.min(options.maxOutputBytes, MAX_ENTRY_READ_BYTES)
        : MAX_ENTRY_READ_BYTES;
      if (entry.size > maxOutputBytes) {
        throw new Error('Esta entrada excede o limite de leitura de ' + Math.round(maxOutputBytes / 1024 / 1024) + ' MB.');
      }
      if (!Number.isSafeInteger(entry.localOffset) || !Number.isSafeInteger(entry.centralOffset) ||
          entry.localOffset < 0 || entry.localOffset + 30 > entry.centralOffset) {
        throw new Error('Offset do cabeçalho local inválido.');
      }

      const localHeader = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      if (localHeader.byteLength !== 30) throw new Error('Cabeçalho ZIP local truncado.');
      const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
      if (localView.getUint32(0, true) !== SIGNATURE.local) throw new Error('Assinatura do cabeçalho ZIP local inválida.');

      const localFlags = localView.getUint16(6, true);
      const localMethod = localView.getUint16(8, true);
      const localCrc = localView.getUint32(14, true);
      const localCompressedSize = localView.getUint32(18, true);
      const localSize = localView.getUint32(22, true);
      const localNameLength = localView.getUint16(26, true);
      const localExtraLength = localView.getUint16(28, true);

      if (localFlags !== entry.flags || localMethod !== entry.method) {
        throw new Error('Cabeçalho local e diretório central discordam sobre flags ou método de compressão.');
      }
      const localNameStart = entry.localOffset + 30;
      const dataStart = localNameStart + localNameLength + localExtraLength;
      if (dataStart > entry.centralOffset || dataStart + entry.compressedSize > entry.centralOffset ||
          dataStart + entry.compressedSize > file.size) {
        throw new Error('Dados da entrada ultrapassam os limites do arquivo ou invadem o diretório central.');
      }

      const localNameBytes = new Uint8Array(await file.slice(localNameStart, localNameStart + localNameLength).arrayBuffer());
      if (localNameBytes.length !== entry.nameBytes.length ||
          localNameBytes.some((byte, index) => byte !== entry.nameBytes[index])) {
        throw new Error('O nome no cabeçalho local difere do diretório central.');
      }

      const hasDataDescriptor = Boolean(entry.flags & 0x0008);
      if (!hasDataDescriptor &&
          (localCrc !== entry.crc || localCompressedSize !== entry.compressedSize || localSize !== entry.size)) {
        throw new Error('Tamanhos ou CRC do cabeçalho local diferem do diretório central.');
      }
      if (hasDataDescriptor &&
          ((localCrc !== 0 && localCrc !== entry.crc) ||
           (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
           (localSize !== 0 && localSize !== entry.size))) {
        throw new Error('Descritor de dados e cabeçalho ZIP central apresentam metadados conflitantes.');
      }

      const compressedBlob = file.slice(dataStart, dataStart + entry.compressedSize);
      if (compressedBlob.size !== entry.compressedSize) throw new Error('Dados compactados truncados.');

      let bytes;
      if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) {
          throw new Error('Entrada STORE possui tamanhos compactado e original diferentes.');
        }
        bytes = new Uint8Array(await compressedBlob.arrayBuffer());
      } else {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('Este navegador não oferece DecompressionStream. Atualize o navegador.');
        }
        let decompressedStream;
        try {
          decompressedStream = compressedBlob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        } catch (error) {
          throw new Error('Não foi possível iniciar a descompressão Deflate: ' + error.message);
        }
        bytes = await readBoundedStream(decompressedStream, entry.size, maxOutputBytes);
      }

      if (bytes.byteLength !== entry.size) throw new Error('Tamanho extraído não corresponde ao declarado no diretório ZIP.');
      const actualCrc = crc32(bytes);
      if (actualCrc !== entry.crc) {
        throw new Error('CRC-32 inválido. Esperado ' + crcHex(entry.crc) + ', obtido ' + crcHex(actualCrc) + '.');
      }
      return bytes;
    }
  };

  return Object.freeze({
    ZIP,
    crc32,
    limits: Object.freeze({
      maxEntryReadBytes: MAX_ENTRY_READ_BYTES,
      maxTotalUncompressedBytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
      maxCentralDirectoryBytes: MAX_CENTRAL_DIRECTORY_BYTES,
      maxEntries: MAX_ENTRIES,
      suspiciousCompressionRatio: SUSPICIOUS_RATIO_THRESHOLD
    }),
    validateArchivePath
  });
});
