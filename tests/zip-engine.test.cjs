const assert = require('node:assert/strict');
const test = require('node:test');
const { deflateRawSync } = require('node:zlib');
const { ZIP, crc32, limits } = require('../zip-engine.js');

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const item of entries) {
    const name = Buffer.from(item.name, 'utf8');
    const data = Buffer.from(item.data || '');
    const method = item.method || 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const declaredSize = item.declaredSize ?? data.length;
    const flags = 0x0800;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(item.externalAttrs || 0x81a40000, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    localOffset += local.length + compressed.length;
  }

  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return new Blob([...localParts, centralData, end]);
}

test('reads a STORE entry and validates CRC-32', async () => {
  const blob = makeZip([{ name: 'Payload/Demo.app/Info.plist', data: '<?xml version="1.0"?><plist/>' }]);
  const entries = await ZIP.directory(blob);
  assert.equal(entries.length, 1);
  const result = await ZIP.read(blob, entries[0]);
  assert.equal(Buffer.from(result).toString('utf8'), '<?xml version="1.0"?><plist/>');
});

test('reads a Deflate entry with bounded streaming decompression', async () => {
  const content = 'IPA Manager test payload '.repeat(2000);
  const blob = makeZip([{ name: 'Payload/Demo.app/resource.txt', data: content, method: 8 }]);
  const entries = await ZIP.directory(blob);
  const result = await ZIP.read(blob, entries[0]);
  assert.equal(Buffer.from(result).toString('utf8'), content);
});

test('rejects parent-directory traversal paths', async () => {
  const blob = makeZip([{ name: 'Payload/Demo.app/../../outside.txt', data: 'x' }]);
  await assert.rejects(() => ZIP.directory(blob), /caminho inseguro/i);
});

test('rejects absolute and backslash paths', async () => {
  for (const name of ['/Payload/Demo.app/file', 'Payload\\Demo.app\\file']) {
    const blob = makeZip([{ name, data: 'x' }]);
    await assert.rejects(() => ZIP.directory(blob), /caminho absoluto|separador inválido/i);
  }
});

test('rejects duplicate paths ignoring case', async () => {
  const blob = makeZip([
    { name: 'Payload/Demo.app/File', data: 'a' },
    { name: 'payload/demo.app/file', data: 'b' }
  ]);
  await assert.rejects(() => ZIP.directory(blob), /duplicados ou equivalentes/i);
});

test('rejects declared expansion beyond the global uncompressed limit', async () => {
  const blob = makeZip([{ name: 'Payload/Demo.app/huge.bin', data: 'x', declaredSize: limits.maxTotalUncompressedBytes + 1 }]);
  await assert.rejects(() => ZIP.directory(blob), /2 GiB/i);
});

test('rejects a local header that disagrees with the central directory', async () => {
  const blob = makeZip([{ name: 'Payload/Demo.app/file', data: 'data', method: 0 }]);
  const bytes = Buffer.from(await blob.arrayBuffer());
  bytes.writeUInt16LE(8, 8);
  await assert.rejects(async () => {
    const altered = new Blob([bytes]);
    const entries = await ZIP.directory(altered);
    await ZIP.read(altered, entries[0]);
  }, /discordam sobre flags ou método/i);
});

test('rejects an entry with a corrupted CRC-32', async () => {
  const blob = makeZip([{ name: 'Payload/Demo.app/file', data: 'data' }]);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const nameLength = Buffer.from('Payload/Demo.app/file').length;
  const centralOffset = 30 + nameLength + 4;
  bytes.writeUInt32LE((bytes.readUInt32LE(centralOffset + 16) ^ 1) >>> 0, centralOffset + 16);
  await assert.rejects(async () => {
    const altered = new Blob([bytes]);
    const entries = await ZIP.directory(altered);
    await ZIP.read(altered, entries[0]);
  }, /CRC-32 inválido|metadados.*conflitantes/i);
});

test('exports deterministic CRC-32 values', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
