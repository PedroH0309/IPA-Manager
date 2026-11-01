'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ota-lab.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'ota-lab.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('OTA lab is discoverable and part of offline shell', () => {
  assert.match(index, /href="\.\/ota-lab\.html"/);
  assert.match(html, /src="\.\/ota-engine\.js"/);
  assert.match(html, /src="\.\/ota-lab\.js"/);
  assert.match(html, /href="\.\/ota-lab\.css"/);
  for (const file of ['ota-lab.html', 'ota-lab.css', 'ota-lab.js']) {
    assert.ok(shell.includes("'./" + file + "'"), 'missing from service worker: ' + file);
  }
});

test('HTML contains all interactive controls and explicit OTA caveat', () => {
  for (const id of [
    'otaDeviceChecks', 'otaManifestForm', 'otaIpaUrl', 'otaBundleId', 'otaVersion',
    'otaAppTitle', 'otaManifestReady', 'otaManifestPreview', 'otaSaveManifest',
    'otaManifestUrl', 'otaCheckManifest', 'otaConfirm', 'otaLaunch',
    'otaOutcome', 'otaError', 'otaExportReport', 'otaCopyReport', 'otaReportStatus'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing control ' + id);
  }
  assert.match(html, /Não é um desbloqueio do iOS/);
  assert.match(html, /não significa instalação concluída/);
});

function makeBrowser() {
  class FakeElement {
    constructor() {
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.textContent = '';
      this.style = {};
      this.listeners = {};
      this.classNames = new Set(['hidden']);
      this.classList = {
        add: name => this.classNames.add(name),
        remove: name => this.classNames.delete(name)
      };
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    trigger(type) { return this.listeners[type]?.({ preventDefault() {} }); }
    setAttribute() {}
    append() {}
    appendChild() {}
    remove() {}
    replaceChildren() {}
    querySelector() { return new FakeElement(); }
  }
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    createElement: () => new FakeElement(),
    body: new FakeElement()
  };
  const launched = [];
  let clipboard = '';
  const navigator = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    standalone: false,
    clipboard: { async writeText(value) { clipboard = value; } }
  };
  const window = {
    IPAOTAEngine: require('../ota-engine.js'),
    location: { protocol: 'https:', assign(value) { launched.push(value); } },
    isSecureContext: true,
    matchMedia: () => ({ matches: false }),
    setTimeout, clearTimeout
  };
  vm.runInNewContext(source, { window, document, navigator, URL, Blob, fetch, DOMParser: class {}, TextDecoder, Uint8Array, Date, console });
  return { el: id => document.getElementById(id), launched, readClipboard: () => clipboard };
}

test('generates a local manifest without claiming it installs', () => {
  const { el } = makeBrowser();
  el('otaIpaUrl').value = 'https://cdn.example.org/authorized.ipa';
  el('otaBundleId').value = 'com.example.authorized';
  el('otaVersion').value = '1.0';
  el('otaAppTitle').value = 'App autorizado';
  el('otaManifestForm').trigger('submit');
  assert.match(el('otaManifestPreview').textContent, /authorized\.ipa/);
  assert.match(el('otaManifestPreview').textContent, /com\.example\.authorized/);
  assert.ok(!el('otaManifestReady').classNames.has('hidden'));
  assert.match(el('otaManifestStatus').textContent, /não comprova/i);
});

test('rejects invalid input and keeps generate result hidden', () => {
  const { el } = makeBrowser();
  el('otaIpaUrl').value = 'http://localhost/app.ipa';
  el('otaBundleId').value = 'com.example.app';
  el('otaVersion').value = '1.0';
  el('otaAppTitle').value = 'App';
  el('otaManifestForm').trigger('submit');
  assert.ok(el('otaManifestReady').classNames.has('hidden'));
  assert.match(el('otaManifestStatus').textContent, /HTTPS/);
});

test('OTA attempt requires explicit permission confirmation', () => {
  const { el, launched } = makeBrowser();
  el('otaManifestUrl').value = 'https://cdn.example.org/install.plist';
  assert.equal(el('otaLaunch').disabled, true);
  el('otaLaunch').trigger('click');
  assert.equal(launched.length, 0);
  el('otaConfirm').checked = true;
  el('otaConfirm').trigger('change');
  assert.equal(el('otaLaunch').disabled, false);
  el('otaLaunch').trigger('click');
  assert.equal(launched.length, 1);
  assert.match(launched[0], /^itms-services:\/\/\?action=download-manifest/);
  assert.match(el('otaLaunchStatus').textContent, /não confirma/i);
});

test('copied diagnostic excludes sensitive URLs and never asserts install verified', async () => {
  const { el, readClipboard } = makeBrowser();
  el('otaManifestUrl').value = 'https://cdn.example.org/install.plist?secretToken=do-not-export';
  el('otaConfirm').checked = true;
  el('otaConfirm').trigger('change');
  el('otaLaunch').trigger('click');
  el('otaOutcome').value = 'installed';
  await el('otaCopyReport').trigger('click');
  const raw = readClipboard();
  const report = JSON.parse(raw);
  assert.equal(report.diagnostics.iosReportedOutcome, 'installed');
  assert.equal(report.diagnostics.otaRequestInitiated, true);
  assert.equal(report.limitations.deviceInstallationVerified, false);
  assert.ok(!raw.includes('do-not-export'));
  assert.ok(!raw.includes('cdn.example.org'));
});
