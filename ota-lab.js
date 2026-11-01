(() => {
  'use strict';
  const engine = window.IPAOTAEngine;
  const el = id => document.getElementById(id);
  const state = {
    manifest: '',
    generated: false,
    remote: 'not-checked',
    requested: false,
    requestTime: null
  };

  const isIOS = () => /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
  const isSafari = () => /Safari/i.test(navigator.userAgent || '') &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent || '');
  const isStandalone = () => navigator.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  const isHTTPS = () => window.location.protocol === 'https:' && window.isSecureContext === true;
  function environment() {
    return { ios: isIOS(), safari: isSafari(), standalone: isStandalone(), https: isHTTPS() };
  }

  function check(title, detail, ok) {
    const row = document.createElement('div');
    row.className = 'ota-check ' + (ok ? 'ok' : 'warn');
    const symbol = document.createElement('span');
    symbol.className = 'ota-check-symbol';
    symbol.textContent = ok ? '✓' : '!';
    symbol.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    const heading = document.createElement('b');
    heading.textContent = title;
    const description = document.createElement('small');
    description.textContent = detail;
    body.append(heading, description);
    row.append(symbol, body);
    return row;
  }
  function renderEnvironment() {
    const env = environment();
    const node = el('otaDeviceChecks');
    node.replaceChildren(
      check('Dispositivo iOS / iPadOS',
        env.ios ? 'Dispositivo identificado. A autorização de instalação ainda será verificada pelo próprio iOS.' :
          'Este navegador não foi identificado como iPhone/iPad. Execute a tentativa no iPhone.', env.ios),
      check('Safari fora do modo PWA',
        env.safari && !env.standalone ? 'Safari reconhecido. Use esta página diretamente no navegador.' :
          'Para o experimento, abra a página diretamente no Safari; PWAs e outros navegadores podem se comportar de maneira diferente.', env.safari && !env.standalone),
      check('Página em contexto HTTPS',
        env.https ? 'A interface está sendo servida por HTTPS.' :
          'Abra a versão HTTPS publicada no GitHub Pages; arquivo local não é suficiente para o teste.', env.https),
      check('Assinatura e autorização do IPA',
        'Não podem ser validadas pela página. A geração de manifesto não substitui certificados, perfis ou confiança do iOS.', false)
    );
  }

  function setMessage(id, message, error = false) {
    const target = el(id);
    target.textContent = message;
    target.style.color = error ? '#f4acaf' : '';
  }
  function saveText(filename, content, mime) {
    const objectURL = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = objectURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 10000);
  }

  el('otaManifestForm').addEventListener('submit', event => {
    event.preventDefault();
    state.generated = false;
    state.manifest = '';
    el('otaManifestReady').classList.add('hidden');
    try {
      state.manifest = engine.makeManifest({
        ipaUrl: el('otaIpaUrl').value,
        bundleId: el('otaBundleId').value,
        title: el('otaAppTitle').value,
        version: el('otaVersion').value
      });
      state.generated = true;
      el('otaManifestPreview').textContent = state.manifest;
      el('otaManifestReady').classList.remove('hidden');
      setMessage('otaManifestStatus', 'Manifesto XML gerado localmente. Isso não comprova que o IPA pode ser instalado.');
    } catch (error) {
      setMessage('otaManifestStatus', error.message || 'Não foi possível gerar o manifesto.', true);
    }
  });

  el('otaSaveManifest').addEventListener('click', () => {
    if (state.generated) saveText('manifest.plist', state.manifest, 'application/xml;charset=utf-8');
  });

  function manifestLink() {
    const url = engine.httpsUrl(el('otaManifestUrl').value, 'manifesto');
    const parsed = new URL(url);
    if (!/\.plist$/i.test(parsed.pathname)) throw new Error('Use uma URL HTTPS para um manifesto .plist publicado.');
    return url;
  }

  el('otaManifestUrl').addEventListener('input', () => {
    state.remote = 'not-checked';
    setMessage('otaRemoteStatus', 'Manifesto alterado. Verifique novamente o acesso se desejar.');
  });

  // CORS is a browser restriction. An opaque/unreadable response is INCONCLUSIVE,
  // never a definitive assertion that Apple's installer cannot access a URL.
  el('otaCheckManifest').addEventListener('click', async () => {
    state.remote = 'not-checked';
    const button = el('otaCheckManifest');
    let url;
    try { url = manifestLink(); } catch (error) {
      setMessage('otaRemoteStatus', error.message, true); return;
    }
    button.disabled = true;
    setMessage('otaRemoteStatus', 'Verificando resposta HTTPS e estrutura do manifesto…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow',
        cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) {
        state.remote = 'http-error';
        setMessage('otaRemoteStatus', 'O servidor respondeu HTTP ' + response.status +
          '. Corrija a hospedagem antes de testar.', true);
        return;
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 256 * 1024) {
        state.remote = 'too-large';
        setMessage('otaRemoteStatus', 'Manifesto maior que 256 KiB; verifique se a URL aponta para o arquivo XML.', true);
        return;
      }
      const reader = response.body && response.body.getReader ? response.body.getReader() : null;
      let body = '';
      if (reader) {
        const chunks = [];
        let total = 0;
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          total += item.value.byteLength;
          if (total > 256 * 1024) {
            await reader.cancel();
            throw new Error('Manifesto excedeu o limite de 256 KiB.');
          }
          chunks.push(item.value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } else {
        body = await response.text();
        if (body.length > 256 * 1024) throw new Error('Manifesto excedeu o limite de 256 KiB.');
      }
      const parsed = new DOMParser().parseFromString(body, 'application/xml');
      if (parsed.querySelector('parsererror') || parsed.documentElement?.nodeName !== 'plist' ||
          !/software-package/.test(body) || !/bundle-identifier/.test(body)) {
        state.remote = 'invalid-xml';
        setMessage('otaRemoteStatus', 'A URL respondeu, mas o XML não parece ser um manifesto OTA válido.', true);
        return;
      }
      state.remote = 'readable';
      const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const suspiciousMime = mime && !['application/xml', 'text/xml', 'application/x-plist', 'application/octet-stream', 'text/plain'].includes(mime);
      setMessage('otaRemoteStatus',
        'Manifesto acessível e estrutura XML básica reconhecida.' +
        (suspiciousMime ? ' Atenção: MIME retornado pelo servidor (' + mime + ').' : '') +
        ' A assinatura do IPA e a instalação ainda NÃO foram verificadas.');
    } catch (error) {
      state.remote = 'inconclusive';
      setMessage('otaRemoteStatus', error?.name === 'AbortError'
        ? 'A verificação excedeu 12 segundos. Resultado inconclusivo.'
        : 'O Safari não conseguiu inspecionar o manifesto (' + (error?.message || 'erro de rede/CORS') +
          '). Isso pode ser bloqueio de CORS; não significa necessariamente que o iOS rejeitará a URL.');
    } finally {
      window.clearTimeout(timeout);
      button.disabled = false;
    }
  });

  function updateButton() {
    el('otaLaunch').disabled = !el('otaConfirm').checked;
  }
  el('otaConfirm').addEventListener('change', updateButton);

  el('otaLaunch').addEventListener('click', () => {
    if (!el('otaConfirm').checked) return;
    if (!isIOS()) {
      setMessage('otaLaunchStatus', 'Abra a página em um iPhone ou iPad para iniciar este teste.', true);
      return;
    }
    if (!isSafari() || isStandalone()) {
      setMessage('otaLaunchStatus', 'Abra a página no Safari normal (fora da tela inicial/PWA) para este teste.', true);
      return;
    }
    let deepLink;
    try {
      deepLink = engine.makeInstallIntent(manifestLink());
    } catch (error) {
      setMessage('otaLaunchStatus', error.message, true); return;
    }
    state.requested = true;
    state.requestTime = new Date().toISOString();
    setMessage('otaLaunchStatus', 'Solicitação enviada ao mecanismo do iOS. Isso não confirma download nem instalação.');
    // The navigation is performed synchronously in the user gesture.
    window.location.assign(deepLink);
  });

  function report() {
    const env = environment();
    return {
      schemaVersion: 1,
      kind: 'ipa-manager-ota-lab',
      generatedAt: new Date().toISOString(),
      environment: {
        iosDetected: env.ios,
        safariDetected: env.safari,
        standalone: env.standalone,
        https: env.https
      },
      diagnostics: {
        localManifestGenerated: state.generated,
        remoteManifestCheck: state.remote,
        otaRequestInitiated: state.requested,
        requestTime: state.requestTime,
        iosReportedOutcome: el('otaOutcome').value,
        userObservedMessage: el('otaError').value.trim().slice(0, 400)
      },
      limitations: {
        appleSignatureVerified: false,
        profileTrustVerified: false,
        deviceInstallationVerified: false,
        distributionEntitlementVerified: false
      }
    };
  }
  function reportJSON() { return JSON.stringify(report(), null, 2) + '\n'; }

  el('otaExportReport').addEventListener('click', () => {
    saveText('ipa-manager-ota-diagnostico.json', reportJSON(), 'application/json;charset=utf-8');
    setMessage('otaReportStatus', 'Relatório preparado. Ele contém apenas estados técnicos e o texto que você digitou.');
  });

  el('otaCopyReport').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reportJSON());
      setMessage('otaReportStatus', 'Diagnóstico copiado para a área de transferência.');
    } catch {
      setMessage('otaReportStatus', 'O Safari não liberou a área de transferência. Use Exportar diagnóstico JSON.', true);
    }
  });

  if (!engine) {
    setMessage('otaManifestStatus', 'O motor OTA não carregou. Reabra o site com conexão e atualize a página.', true);
    el('otaManifestForm').querySelector('button[type=submit]').disabled = true;
    el('otaCheckManifest').disabled = true;
    el('otaLaunch').disabled = true;
  }
  renderEnvironment();
  updateButton();
})();
