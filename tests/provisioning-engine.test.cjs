const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractEmbeddedPlist, analyzeProvisioningProfile, matchAppIdentifier, limits
} = require('../provisioning-engine.js');

// Synthetic fixtures exercise metadata parsing only. They are not CMS-signed
// profiles or authentic Apple provisioning assets.
const now = new Date('2026-11-01T16:00:00.000Z');
function makeProfile(overrides = {}) {
  return {
    TeamIdentifier: ['ABCDE12345'],
    Entitlements: { 'application-identifier': 'ABCDE12345.com.demo.app', 'get-task-allow': false },
    CreationDate: '2026-01-01T00:00:00Z',
    ExpirationDate: '2027-01-01T00:00:00Z',
    ProvisionedDevices: ['DO-NOT-DISPLAY-PRIVATE-DEVICE-ID'],
    DeveloperCertificates: ['CERTIFICATE-BYTES-NEVER-RETURNED'],
    ...overrides
  };
}
function inspect(profile, id = 'com.demo.app') {
  return analyzeProvisioningProfile(profile, id, { now });
}
test('extracts an XML plist from synthetic CMS-like bytes without claiming CMS verification', () => {
  const plist = '<plist version="1.0"><dict><key>Name</key><string>Demo</string></dict></plist>';
  const payload = Buffer.concat([Buffer.from([0x30, 0x82, 0x00, 0x20, 0x04]), Buffer.from(plist), Buffer.from([0, 1, 2])]);
  assert.equal(extractEmbeddedPlist(new Uint8Array(payload)), plist);
});
test('rejects missing, truncated and invalid UTF-8 XML', () => {
  assert.throws(() => extractEmbeddedPlist(new Uint8Array([1, 2, 3])), /não contém um plist/i);
  assert.throws(() => extractEmbeddedPlist(new TextEncoder().encode('<plist version="1.0">')), /truncado/i);
  assert.throws(() => extractEmbeddedPlist(new Uint8Array(Buffer.concat([
    Buffer.from('<plist>'), Buffer.from([0xff]), Buffer.from('</plist>')
  ]))), /UTF-8 inválido/i);
});
test('rejects oversized profiles before scanning or parsing', () => {
  assert.equal(limits.maxProfileBytes, 4 * 1024 * 1024);
  assert.throws(() => extractEmbeddedPlist(new Uint8Array(limits.maxProfileBytes + 1)), /4 MiB/i);
});
test('classifies a development profile without inferring iPhone installation authorization', () => {
  const result = inspect(makeProfile({
    Entitlements: { 'application-identifier': 'ABCDE12345.com.demo.app', 'get-task-allow': true }
  }));
  assert.equal(result.type, 'desenvolvimento');
  assert.equal(result.status, 'inconclusivo');
  assert.equal(result.bundleIdMatch, true);
  assert.equal(result.registeredDeviceCount, 1);
  assert.equal(result.cmsCryptographicallyVerified, false);
  assert.equal(result.appleTrustVerified, false);
  assert.equal(result.installable, null);
});
test('finds an expired provisioning profile and marks it inconsistent', () => {
  const result = inspect(makeProfile({ ExpirationDate: '2020-01-01T00:00:00Z' }));
  assert.equal(result.expired, true);
  assert.equal(result.status, 'inconsistente');
});
test('finds mismatched application identifiers', () => {
  const result = inspect(makeProfile({
    Entitlements: { 'application-identifier': 'ABCDE12345.com.other.app' }
  }));
  assert.equal(result.bundleIdMatch, false);
  assert.equal(result.status, 'inconsistente');
});
test('matches exact and wildcard app identifiers only with a matching team prefix', () => {
  assert.equal(matchAppIdentifier('ABCDE12345.com.demo.*', 'com.demo.app', ['ABCDE12345']), true);
  assert.equal(matchAppIdentifier('ABCDE12345.com.demo.*', 'com.unrelated.app', ['ABCDE12345']), false);
  assert.equal(matchAppIdentifier('OTHER12345.com.demo.app', 'com.demo.app', ['ABCDE12345']), false);
  assert.equal(matchAppIdentifier('ABCDE12345.com.demo.app', '', ['ABCDE12345']), null);
});
test('distinguishes device-scope metadata without proving device eligibility', () => {
  const result = inspect(makeProfile({
    ProvisionsAllDevices: true,
    ProvisionedDevices: undefined
  }));
  assert.equal(result.deviceScope, 'todos-dispositivos-declarados');
  assert.equal(result.type, 'in-house-ou-distribuicao-especial');
  assert.equal(result.registeredDeviceCount, null);
  assert.equal(result.installable, null);
});
test('handles a distribution profile without a device list', () => {
  const result = inspect(makeProfile({ ProvisionedDevices: undefined }));
  assert.equal(result.type, 'distribuicao-sem-lista');
  assert.equal(result.deviceScope, 'sem-lista-de-dispositivos');
});
test('marks unknown expiry and App ID as inconclusive, never approved', () => {
  const result = inspect({ Entitlements: {}, ExpirationDate: 'NOT-A-DATE' });
  assert.equal(result.expired, null);
  assert.equal(result.bundleIdMatch, null);
  assert.equal(result.status, 'inconclusivo');
});
test('never returns raw device identifiers, certificate blobs, private profile keys or an install approval', () => {
  const result = inspect(makeProfile({
    UUID: 'PRIVATE-UUID',
    ProvisionedDevices: ['SECRET-UDID-EXAMPLE']
  }));
  const serialized = JSON.stringify(result);
  for (const secret of ['SECRET-UDID-EXAMPLE', 'PRIVATE-UUID', 'CERTIFICATE-BYTES-NEVER-RETURNED']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(result.installable, null);
});
