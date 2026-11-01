const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { auditExecutable, limits } = require('../signature-engine.js');

async function signedMachO({ cms = true, tamper = false, unsigned = false, hashType = 2 } = {}) {
  const bytes = Buffer.alloc(4096);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(unsigned ? 0 : 1, 16);
  bytes.writeUInt32LE(unsigned ? 0 : 16, 20);
  if (unsigned) return new Uint8Array(bytes);
  const directoryLength = 44 + 32;
  const superblobLength = 12 + (cms ? 2 : 1) * 8 + directoryLength + (cms ? 12 : 0);
  bytes.writeUInt32LE(0x1d, 32);
  bytes.writeUInt32LE(16, 36);
  bytes.writeUInt32LE(4096, 40);
  bytes.writeUInt32LE(superblobLength, 44);
  const pageHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes));
  const superblob = Buffer.alloc(superblobLength);
  superblob.writeUInt32BE(0xfade0cc0, 0);
  superblob.writeUInt32BE(superblobLength, 4);
  superblob.writeUInt32BE(cms ? 2 : 1, 8);
  const cdOffset = cms ? 28 : 20;
  superblob.writeUInt32BE(0, 12);
  superblob.writeUInt32BE(cdOffset, 16);
  if (cms) {
    superblob.writeUInt32BE(0x10000, 20);
    superblob.writeUInt32BE(cdOffset + directoryLength, 24);
  }
  superblob.writeUInt32BE(0xfade0c02, cdOffset);
  superblob.writeUInt32BE(directoryLength, cdOffset + 4);
  superblob.writeUInt32BE(0x20000, cdOffset + 8);
  superblob.writeUInt32BE(44, cdOffset + 16);
  superblob.writeUInt32BE(44, cdOffset + 20);
  superblob.writeUInt32BE(0, cdOffset + 24);
  superblob.writeUInt32BE(1, cdOffset + 28);
  superblob.writeUInt32BE(4096, cdOffset + 32);
  superblob.writeUInt8(hashType === 3 ? 20 : 32, cdOffset + 36);
  superblob.writeUInt8(hashType, cdOffset + 37);
  superblob.writeUInt8(12, cdOffset + 39);
  pageHash.copy(superblob, cdOffset + 44);
  if (cms) {
    const off = cdOffset + directoryLength;
    superblob.writeUInt32BE(0xfade0b01, off);
    superblob.writeUInt32BE(12, off + 4);
    superblob.writeUInt32BE(0xdeadbeef, off + 8);
  }
  const result = Buffer.concat([bytes, superblob]);
  if (tamper) result[128] ^= 1;
  return new Uint8Array(result);
}

test('verifies SHA-256 page hashes in a Mach-O CodeDirectory', async () => {
  const bytes = await signedMachO();
  const result = await auditExecutable(bytes, { subtle: webcrypto.subtle });
  assert.equal(result.status, 'match');
  assert.equal(result.cmsPresent, true);
  assert.equal(result.architectures[0].checkedSlots, 1);
  assert.match(result.architectures[0].cdhash, /^[a-f0-9]{40}$/);
});

test('detects changes to signed executable page data', async () => {
  const bytes = await signedMachO({ tamper: true });
  const result = await auditExecutable(bytes, { subtle: webcrypto.subtle });
  assert.equal(result.status, 'mismatch');
});

test('reports unsigned Mach-O instead of claiming a valid signature', async () => {
  const result = await auditExecutable(await signedMachO({ unsigned: true }), { subtle: webcrypto.subtle });
  assert.equal(result.status, 'unsigned');
  assert.equal(result.cmsPresent, false);
});

test('distinguishes matching ad-hoc page hashes from CMS-signed code', async () => {
  const result = await auditExecutable(await signedMachO({ cms: false }), { subtle: webcrypto.subtle });
  assert.equal(result.status, 'match');
  assert.equal(result.cmsPresent, false);
});

test('rejects malformed SuperBlob offsets', async () => {
  const bytes = await signedMachO();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(4096 + 16, 999999, false);
  await assert.rejects(() => auditExecutable(bytes, { subtle: webcrypto.subtle }), /fora dos limites/i);
});

test('rejects Mach-O load command lengths outside the file', async () => {
  const bytes = await signedMachO();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(32 + 4, 0xfffffff0, true);
  await assert.rejects(() => auditExecutable(bytes, { subtle: webcrypto.subtle }), /fora dos limites/i);
});

test('declares unsupported instead of passing when page validation budget is too low', async () => {
  const result = await auditExecutable(await signedMachO(), { subtle: webcrypto.subtle, maxPages: 0 });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.architectures[0].checkedSlots, 0);
});

test('does not process executable binaries over 64 MiB', async () => {
  assert.equal(limits.maxBinaryBytes, 64 * 1024 * 1024);
  await assert.rejects(() => auditExecutable(new Uint8Array(64 * 1024 * 1024 + 1)), /64 MiB/i);
});

test('rejects unrecognized executable formats', async () => {
  await assert.rejects(() => auditExecutable(new Uint8Array(96), { subtle: webcrypto.subtle }), /não é Mach-O/i);
});
