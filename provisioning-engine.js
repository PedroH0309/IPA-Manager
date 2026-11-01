(function registerIPAProvisioningEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IPAProvisioningEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIPAProvisioningEngine() {
  'use strict';

  // This module reads descriptive metadata ONLY. A provisioning profile is a CMS-
  // wrapped plist; extracting its unsigned payload does not validate the CMS
  // signature, issuer, embedded certificates, or Apple's current trust decision.
  const MAX_PROFILE_BYTES = 4 * 1024 * 1024;
  const MAX_XML_BYTES = 2 * 1024 * 1024;
  const START = new TextEncoder().encode('<plist');
  const END = new TextEncoder().encode('</plist>');

  function findSequence(bytes, sequence, from = 0) {
    const end = bytes.length - sequence.length;
    for (let i = from; i <= end; i++) {
      if (bytes[i] !== sequence[0]) continue;
      let equal = true;
      for (let j = 1; j < sequence.length; j++) {
        if (bytes[i + j] !== sequence[j]) { equal = false; break; }
      }
      if (equal) return i;
    }
    return -1;
  }

  function extractEmbeddedPlist(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error('Perfil de provisionamento vazio ou inválido.');
    }
    if (bytes.byteLength > MAX_PROFILE_BYTES) {
      throw new Error('Perfil excede o limite de 4 MiB para inspeção local.');
    }
    const start = findSequence(bytes, START);
    if (start < 0) {
      throw new Error('O perfil não contém um plist XML reconhecível. Formatos binários ou CMS não suportados são inconclusivos.');
    }
    const end = findSequence(bytes, END, start + START.length);
    if (end < 0 || end + END.length - start > MAX_XML_BYTES) {
      throw new Error('Plist do provisionamento ausente, truncado ou maior que 2 MiB.');
    }
    const xmlBytes = bytes.subarray(start, end + END.length);
    let xml;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
    } catch {
      throw new Error('Plist de provisionamento contém UTF-8 inválido.');
    }
    if (!/^<plist(?:\s|>)/.test(xml)) {
      throw new Error('Início do plist de provisionamento inválido.');
    }
    return xml;
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 48) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function matchAppIdentifier(identifier, bundleId, team) {
    if (typeof identifier !== 'string' || !identifier || typeof bundleId !== 'string' || !bundleId) {
      return null;
    }
    if (!Array.isArray(team) || !team.some(id => typeof id === 'string' && id.length > 0)) return null;
    const validPrefixes = team.filter(id => typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id));
    if (!validPrefixes.length) return null;
    for (const prefix of validPrefixes) {
      if (!identifier.startsWith(prefix + '.')) continue;
      const pattern = identifier.slice(prefix.length + 1);
      if (pattern === bundleId) return true;
      if (pattern.endsWith('*') && pattern.indexOf('*') === pattern.length - 1 &&
          bundleId.startsWith(pattern.slice(0, -1))) return true;
    }
    return false;
  }

  function analyzeProvisioningProfile(profile, bundleId, options = {}) {
    if (!plainObject(profile)) {
      throw new Error('O plist extraído não contém um dicionário de provisionamento.');
    }
    const now = options.now instanceof Date ? options.now.getTime() : Date.now();
    if (!Number.isFinite(now)) throw new Error('Data de referência inválida.');

    const entitlements = plainObject(profile.Entitlements) ? profile.Entitlements : {};
    const team = Array.isArray(profile.TeamIdentifier)
      ? profile.TeamIdentifier.filter(item => typeof item === 'string')
      : [];
    const appIdentifier = entitlements['application-identifier'] ||
      entitlements['com.apple.application-identifier'] || '';
    const bundleIdMatch = matchAppIdentifier(appIdentifier, bundleId, team);
    const expiration = timestamp(profile.ExpirationDate);
    const creation = timestamp(profile.CreationDate);
    const expired = expiration === null ? null : expiration <= now;
    const createdInFuture = creation === null ? null : creation > now;
    const registeredCount = Array.isArray(profile.ProvisionedDevices) ? profile.ProvisionedDevices.length : null;
    const allDevices = profile.ProvisionsAllDevices === true;
    const allowsDebugging = entitlements['get-task-allow'] === true;
    const deviceScope = allDevices ? 'todos-dispositivos-declarados' :
      registeredCount !== null ? 'dispositivos-listados' : 'sem-lista-de-dispositivos';
    const type = allDevices ? 'in-house-ou-distribuicao-especial' :
      registeredCount !== null ? (allowsDebugging ? 'desenvolvimento' : 'ad-hoc-ou-teste') :
      'distribuicao-sem-lista';
    const issues = [];
    if (expired === true) issues.push('O perfil declara uma data de expiração já ultrapassada.');
    if (createdInFuture === true) issues.push('A data de criação declarada está no futuro.');
    if (bundleIdMatch === false) issues.push('O identificador de aplicativo do perfil não corresponde ao Bundle ID do IPA.');
    if (expiration === null) issues.push('Não foi possível determinar a expiração do perfil.');
    if (bundleIdMatch === null) issues.push('Não foi possível conferir o App ID do perfil com o Bundle ID.');
    if (registeredCount !== null) {
      issues.push('Não é possível confirmar se este iPhone está entre os dispositivos autorizados sem verificação nativa do dispositivo.');
    }

    const status = expired === true || createdInFuture === true || bundleIdMatch === false
      ? 'inconsistente' : 'inconclusivo';

    return Object.freeze({
      status,
      type,
      deviceScope,
      expirationDate: expiration === null ? null : new Date(expiration).toISOString(),
      creationDate: creation === null ? null : new Date(creation).toISOString(),
      expired,
      bundleIdMatch,
      registeredDeviceCount: registeredCount,
      allowsDebugging,
      developerCertificateCount: Array.isArray(profile.DeveloperCertificates)
        ? profile.DeveloperCertificates.length : null,
      issues,
      cmsCryptographicallyVerified: false,
      appleTrustVerified: false,
      installable: null
    });
  }

  return Object.freeze({
    extractEmbeddedPlist,
    analyzeProvisioningProfile,
    matchAppIdentifier,
    limits: Object.freeze({ maxProfileBytes: MAX_PROFILE_BYTES, maxXmlBytes: MAX_XML_BYTES })
  });
});
