'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { httpsUrl, makeManifest, makeInstallIntent } = require('../ota-engine.js');
const good = { ipaUrl: 'https://cdn.example.org/apps/App.ipa?token=public', bundleId: 'com.example.app', title: 'App & Teste <OK>', version: '1.2.3' };

test('builds valid plist OTA with XML escaped values', () => {
  const manifest = makeManifest(good);
  assert.match(manifest, /<string>software-package<\/string>/);
  assert.match(manifest, /App &amp; Teste &lt;OK&gt;/);
  assert.match(manifest, /<string>com\.example\.app<\/string>/);
  assert.match(manifest, /App\.ipa\?token=public/);
});

test('creates correct iOS OTA deep link from hosted manifest', () => {
  assert.equal(makeInstallIntent('https://cdn.example.org/install.plist?a=1&b=2'),
    'itms-services://?action=download-manifest&url=https%3A%2F%2Fcdn.example.org%2Finstall.plist%3Fa%3D1%26b%3D2');
});
test('rejects direct IPA as manifest', () => {
  assert.throws(() => makeInstallIntent('https://cdn.example.org/App.ipa'), /manifesto/);
});
test('rejects insecure, local, credentialed or suspicious URLs', () => {
  for (const value of [
    'http://example.org/a.ipa', 'https://user:pass@example.org/a.ipa',
    'https://localhost/a.ipa', 'https://192.168.1.4/a.ipa',
    'https://127.0.0.1/a.ipa', 'https://10.0.0.1/a.ipa',
    'https://172.16.0.1/a.ipa', 'https://example.org:8443/a.ipa',
    'https://example.org/a.ipa#fragment',
    'javascript:alert(1)', 'https://example.org\\@evil.com/a.ipa'
  ]) assert.throws(() => httpsUrl(value, 'IPA'), undefined, value);
});
test('rejects invalid bundle IDs and metadata', () => {
  assert.throws(() => makeManifest({...good, bundleId:'*'}), /Bundle ID/);
  assert.throws(() => makeManifest({...good, version:'<script>'}), /Versão/);
  assert.throws(() => makeManifest({...good, title:''}), /Nome/);
  assert.throws(() => makeManifest({...good, ipaUrl:'https://example.org/file.zip'}), /\.ipa/);
});
test('enforces bounded input lengths', () => {
  assert.throws(() => makeManifest({...good, title:'A'.repeat(101)}), /Nome/);
  assert.throws(() => httpsUrl('https://example.org/' + 'a'.repeat(2050),'URL'), /válida/);
});
test('does not require or solicit credentials or device identifiers', () => {
  const manifest = makeManifest(good);
  assert.ok(!/udid|password|certificate|apple id/i.test(manifest));
});
