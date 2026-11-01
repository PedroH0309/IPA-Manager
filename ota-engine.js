(function registerIPAOTAEngine(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IPAOTAEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIPAOTAEngine() {
  'use strict';

  // This engine creates OTA metadata and an iOS installation intent. It DOES NOT
  // sign, notarize, authorize, upload, or install apps. iOS makes the trust decision.
  function httpsUrl(value, role) {
    if (typeof value !== 'string' || value.length > 2048 || !value.trim()) {
      throw new Error('Informe uma URL HTTPS válida para ' + role + '.');
    }
    const raw = value.trim();
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) throw new Error('URL contém caracteres proibidos.');
    let url;
    try { url = new URL(raw); } catch { throw new Error('URL de ' + role + ' inválida.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash ||
        (url.port && url.port !== '443')) {
      throw new Error('A URL de ' + role + ' deve usar HTTPS público, sem credenciais, fragmentos ou portas especiais.');
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
        hostname === '[::1]' || /^127\./.test(hostname) || /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '0.0.0.0') {
      throw new Error('A URL de ' + role + ' precisa ser acessível pela internet, não uma rede local.');
    }
    return url.href;
  }

  function xml(value) {
    if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error('Metadados contêm caracteres XML inválidos.');
    }
    return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  }

  function makeManifest(input) {
    if (!input || typeof input !== 'object') throw new Error('Dados de instalação ausentes.');
    const ipaUrl = httpsUrl(input.ipaUrl, 'IPA');
    const parsed = new URL(ipaUrl);
    if (!/\.ipa$/i.test(parsed.pathname)) {
      throw new Error('O endereço do pacote precisa apontar para um arquivo .ipa em HTTPS.');
    }
    const bundleId = String(input.bundleId || '').trim();
    if (bundleId.length > 255 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(bundleId)) {
      throw new Error('Bundle ID inválido (exemplo: com.empresa.aplicativo).');
    }
    const title = String(input.title || '').trim();
    if (!title || title.length > 100) throw new Error('Nome do aplicativo deve ter de 1 a 100 caracteres.');
    const version = String(input.version || '').trim();
    if (!version || version.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
      throw new Error('Versão inválida.');
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0">\n<dict>\n' +
      '  <key>items</key>\n  <array>\n    <dict>\n' +
      '      <key>assets</key>\n      <array>\n        <dict>\n' +
      '          <key>kind</key><string>software-package</string>\n' +
      '          <key>url</key><string>' + xml(ipaUrl) + '</string>\n' +
      '        </dict>\n      </array>\n' +
      '      <key>metadata</key>\n      <dict>\n' +
      '        <key>bundle-identifier</key><string>' + xml(bundleId) + '</string>\n' +
      '        <key>bundle-version</key><string>' + xml(version) + '</string>\n' +
      '        <key>kind</key><string>software</string>\n' +
      '        <key>title</key><string>' + xml(title) + '</string>\n' +
      '      </dict>\n    </dict>\n  </array>\n</dict>\n</plist>\n';
  }

  function makeInstallIntent(manifestUrl) {
    const url = httpsUrl(manifestUrl, 'manifesto');
    if (/\.ipa$/i.test(new URL(url).pathname)) {
      throw new Error('Informe a URL do manifesto .plist, não o link direto do IPA.');
    }
    return 'itms-services://?action=download-manifest&url=' + encodeURIComponent(url);
  }

  return Object.freeze({ httpsUrl, makeManifest, makeInstallIntent });
});
