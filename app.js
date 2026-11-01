'use strict';

const NUVIO_SOURCE = 'https://raw.githubusercontent.com/NuvioMedia/NuvioMobile/cmp-rewrite/store.json';
const STORAGE_KEY = 'ipa-manager-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { file: null, entries: [], info: null, appPrefix: '', hash: '', currentEntry: null, appBundleZip: null, appBundleName: '', rebuiltIpa: null, rebuiltIpaName: '', libraryTab: 'packages', activity: [], sources: [], packages: [], checks: 0 };
let toastTimer;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB','MB','GB','TB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}
function notify(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sources: state.sources, packages: state.packages, checks: state.checks,
      activity: state.activity.slice(0, 40)
    }));
  } catch (error) { console.warn('Não foi possível salvar o histórico local:', error); }
  updateStats();
}
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.sources = Array.isArray(saved.sources) ? saved.sources : [];
    state.packages = Array.isArray(saved.packages) ? saved.packages : [];
    state.checks = Number(saved.checks) || 0;
    state.activity = Array.isArray(saved.activity) ? saved.activity : [];
  } catch { state.sources = []; state.packages = []; state.activity = []; state.checks = 0; }
  updateStats(); renderSources(); renderRecent(); renderLibrary();
}
function logActivity(title, detail, kind = 'file') {
  state.activity.unshift({ title, detail, kind, date: new Date().toISOString() });
  state.activity = state.activity.slice(0, 40); persist(); renderRecent(); renderLibrary();
}
function updateStats() {
  $('#statInspected').textContent = state.packages.length;
  $('#statSources').textContent = state.sources.length;
  $('#statChecks').textContent = state.checks;
  $('#sourceCount').textContent = `${state.sources.length} ${state.sources.length === 1 ? 'fonte' : 'fontes'}`;
}
function navigate(view) {
  const target = $(`#view-${view}`);
  if (!target) return;
  $$('.view').forEach(el => el.classList.toggle('active', el === target));
  $$('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (view === 'library') renderLibrary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-goto]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goto)));
$('#helpTop').addEventListener('click', () => navigate('help'));
$('.notice-close')?.addEventListener('click', () => $('.notice')?.remove());

// ZIP central-directory reader: supports stored (0) and Deflate (8), rejects encryption and Zip64.
const { ZIP, crc32 } = window.IPAZipEngine;
const { download: downloadRemoteArchive, validateDownloadUrl } = window.IPADownloadEngine;

// Apple binary/XML property-list decoder. Binary format supports common scalar, array and dictionary types.
function parsePlist(bytes) {
  if (bytes.length >= 8 && new TextDecoder().decode(bytes.subarray(0, 8)) === 'bplist00') return parseBinaryPlist(bytes);
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('<?xml') && !text.startsWith('<plist') && !text.startsWith('<!DOCTYPE')) throw new Error('Info.plist não está em XML ou binary plist reconhecido.');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('XML plist inválido.');
  const root = xml.querySelector('plist')?.firstElementChild;
  if (!root) throw new Error('Elemento raiz do plist não encontrado.');
  return parseXmlNode(root);
}
function parseXmlNode(node) {
  switch (node.tagName) {
    case 'dict': { const obj = {}; const children = [...node.children]; for (let i = 0; i < children.length; i += 2) { if (children[i]?.tagName !== 'key' || !children[i + 1]) continue; obj[children[i].textContent] = parseXmlNode(children[i + 1]); } return obj; }
    case 'array': return [...node.children].map(parseXmlNode);
    case 'string': case 'key': return node.textContent || '';
    case 'integer': return Number(node.textContent);
    case 'real': return Number(node.textContent);
    case 'true': return true; case 'false': return false;
    case 'date': return node.textContent;
    case 'data': return `[data ${node.textContent.replace(/\s/g, '').length} chars]`;
    default: return node.textContent || '';
  }
}
function parseBinaryPlist(bytes) {
  if (bytes.length < 40) throw new Error('Binary plist muito pequeno.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6], refSize = bytes[trailer + 7];
  const numObjects = Number(view.getBigUint64(trailer + 8, false));
  const topObject = Number(view.getBigUint64(trailer + 16, false));
  const offsetTableOffset = Number(view.getBigUint64(trailer + 24, false));
  if (!Number.isSafeInteger(numObjects) || numObjects < 1 || numObjects > 1000000 || ![1,2,4,8].includes(offsetSize) || ![1,2,4,8].includes(refSize)) throw new Error('Trailer do binary plist inválido ou fora dos limites.');
  if (topObject >= numObjects || offsetTableOffset >= bytes.length) throw new Error('Offsets do binary plist inválidos.');
  const readUnsigned = (pos, size) => { if (pos < 0 || pos + size > bytes.length) throw new Error('Binary plist truncado.'); let n = 0n; for (let i=0;i<size;i++) n = (n << 8n) | BigInt(bytes[pos+i]); return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n; };
  const offsets = []; for (let i=0;i<numObjects;i++) offsets.push(Number(readUnsigned(offsetTableOffset + i*offsetSize, offsetSize)));
  const active = new Set();
  function parseObject(index, depth = 0) {
    if (depth > 120) throw new Error('Profundidade excessiva no binary plist.');
    if (!Number.isInteger(index) || index < 0 || index >= numObjects) throw new Error('Referência de objeto inválida no plist.');
    if (active.has(index)) throw new Error('Referência circular inesperada no plist.');
    const pos = offsets[index]; if (pos < 8 || pos >= offsetTableOffset) throw new Error('Offset de objeto fora dos limites.');
    const marker = bytes[pos], type = marker >> 4, info = marker & 15; let cursor = pos + 1, length = info;
    if ([4,5,6,10,13].includes(type) && info === 15) {
      const intMarker = bytes[cursor++];
      if ((intMarker >> 4) !== 1) throw new Error('Comprimento estendido inválido no plist.');
      const intBytes = 1 << (intMarker & 15); length = Number(readUnsigned(cursor, intBytes)); cursor += intBytes;
      if (!Number.isSafeInteger(length) || length > 5000000) throw new Error('Objeto muito grande no plist.');
    }
    switch(type) {
      case 0: return info === 8 ? false : info === 9 ? true : null;
      case 1: { const n = readUnsigned(cursor, 1 << info); return typeof n === 'bigint' ? n.toString() : n; }
      case 2: { const size = 1 << info; if (size === 4) return view.getFloat32(cursor, false); if (size === 8) return view.getFloat64(cursor, false); throw new Error('Real com largura não suportada.'); }
      case 3: return new Date(Date.UTC(2001,0,1) + view.getFloat64(cursor, false) * 1000).toISOString();
      case 4: return `[data ${length} bytes]`;
      case 5: return new TextDecoder('ascii').decode(bytes.subarray(cursor, cursor+length));
      case 6: { let out=''; for(let i=0;i<length;i++){const code=(bytes[cursor+i*2]<<8)|bytes[cursor+i*2+1];out+=String.fromCharCode(code);} return out; }
      case 8: return `UID:${readUnsigned(cursor, info+1)}`;
      case 10: case 13: {
        active.add(index);
        const refCount = type === 10 ? length : length * 2;
        if (refCount > 200000 || cursor + refCount*refSize > bytes.length) throw new Error('Coleção plist fora dos limites.');
        const refs=[]; for(let i=0;i<refCount;i++) refs.push(Number(readUnsigned(cursor+i*refSize, refSize)));
        let result;
        if (type === 10) result = refs.map(ref => parseObject(ref, depth+1));
        else { result={}; for(let i=0;i<length;i++){const key=parseObject(refs[i],depth+1);const val=parseObject(refs[length+i],depth+1);result[String(key)]=val;} }
        active.delete(index); return result;
      }
      default: return null;
    }
  }
  return parseObject(topObject);
}

function safeFileName(path) {
  const basename = String(path).split('/').pop() || 'arquivo.bin';
  return basename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'arquivo.bin';
}
function detectEntryType(path) {
  if (/\.app\//i.test(path) || /\.app$/i.test(path)) return 'app';
  if (/_CodeSignature|\.mobileprovision|CodeResources/i.test(path)) return 'signature';
  if (/\.plist$/i.test(path)) return 'plist';
  if (/\.framework\//i.test(path) || /\.dylib$/i.test(path)) return 'framework';
  return 'other';
}
function entryLabel(path) { return path.split('/').pop() || path; }
function crcHex(n) { return n.toString(16).padStart(8,'0'); }

async function inspectFile(file) {
  if (!file || !/\.ipa$/i.test(file.name)) {
    if (!file) return;
    notify('Selecione um arquivo com extensão .ipa.'); return;
  }
  if (file.size > 700 * 1024 * 1024) { notify('Arquivo acima de 700 MB: análise bloqueada para proteger a memória do navegador móvel.'); return; }
  state.file = file; state.entries = []; state.info = null; state.appPrefix = ''; state.hash = ''; state.appBundleZip = null; state.appBundleName = ''; state.rebuiltIpa = null; state.rebuiltIpaName = '';
  $('#appExportPanel')?.classList.add('hidden'); $('#rebuiltPanel')?.classList.add('hidden');
  $('#extractApp').disabled = true; $('#rebuildIpa').disabled = true;
  $('#filePanel').classList.remove('hidden'); $('#fileName').textContent = file.name; $('#fileSize').textContent = formatBytes(file.size);
  $('#metadataGrid').innerHTML = ''; $('#entryList').innerHTML = ''; $('#hashResult').classList.add('hidden'); $('#signatureCard').textContent = '';
  $('#progressTrack').classList.remove('hidden'); $('#progressBar').style.width = '12%'; $('#fileStatus').textContent = 'Lendo diretório ZIP…';
  try {
    const entries = await ZIP.directory(file); state.entries = entries;
    $('#progressBar').style.width = '38%';
    const infoEntry = entries.find(entry => /^Payload\/[^/]+\.app\/Info\.plist$/i.test(entry.name));
    if (!infoEntry) throw new Error('Não foi encontrado Payload/[App].app/Info.plist. O arquivo talvez não seja um IPA válido.');
    state.appPrefix = infoEntry.name.slice(0, -'Info.plist'.length);
    $('#fileStatus').textContent = 'Extraindo metadados do aplicativo…';
    const plistBytes = await ZIP.read(file, infoEntry);
    if (crc32(plistBytes) !== infoEntry.crc) throw new Error('CRC de Info.plist não confere: o arquivo pode estar corrompido.');
    const info = parsePlist(plistBytes);
    if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Info.plist não contém um dicionário de aplicativo.');
    state.info = info;
    $('#progressBar').style.width = '100%'; $('#fileStatus').textContent = 'Estrutura ZIP lida; metadados encontrados.';
    const fields = [
      ['Nome', info.CFBundleDisplayName || info.CFBundleName || '—'],
      ['Versão', info.CFBundleShortVersionString || '—'],
      ['Build', info.CFBundleVersion || '—'],
      ['Bundle ID', info.CFBundleIdentifier || '—'],
      ['iOS mínimo', info.MinimumOSVersion || 'Não declarado'],
      ['Plataforma', Array.isArray(info.CFBundleSupportedPlatforms) ? info.CFBundleSupportedPlatforms.join(', ') : 'iOS / não declarado'],
      ['Entradas ZIP', entries.length],
      ['App bundle', state.appPrefix.replace(/\/$/, '')]
    ];
    $('#metadataGrid').innerHTML = fields.map(([label,value]) => `<div class="meta-box"><span>${escapeHTML(label)}</span><b>${escapeHTML(value)}</b></div>`).join('');
    $('#entryCount').textContent = `${entries.length} itens`;
    renderEntries();
    const codeResources = entries.some(e => e.name === `${state.appPrefix}_CodeSignature/CodeResources`);
    const embedded = entries.some(e => e.name === `${state.appPrefix}embedded.mobileprovision`);
    const hasSignatureBits = codeResources || embedded;
    $('#extractApp').disabled = false; $('#rebuildIpa').disabled = false;
    $('#signatureCard').innerHTML = `<strong>${hasSignatureBits ? 'Indicadores de assinatura encontrados' : 'Indicadores de assinatura não encontrados'}</strong><br>${codeResources ? '✓ _CodeSignature/CodeResources presente. ' : '— CodeResources ausente. '}${embedded ? '✓ embedded.mobileprovision presente.' : '— Perfil embedded.mobileprovision ausente.'}<br><span style="color:#748ba4">Isso não valida a assinatura criptográfica nem garante que o iOS aceite o pacote.</span>`;
    const record = { name: file.name, size: file.size, bundleId: info.CFBundleIdentifier || '', version: info.CFBundleShortVersionString || '', date: new Date().toISOString() };
    state.packages = [record, ...state.packages.filter(p => !(p.name === record.name && p.size === record.size))].slice(0, 50);
    logActivity(file.name, `${record.bundleId || 'Bundle ID não declarado'} · ${formatBytes(file.size)}`, 'file');
    renderLibrary();
    $('#progressTrack').classList.add('hidden');
    notify('IPA analisado localmente.');
  } catch (error) {
    $('#progressBar').style.width = '100%'; $('#progressBar').style.background = '#ff737d';
    $('#fileStatus').textContent = `Falha na análise: ${error.message}`;
    $('#signatureCard').innerHTML = '<strong>Análise inconclusiva.</strong><br>Não instale um arquivo se a origem ou a integridade não puderem ser confirmadas.';
    $('#progressTrack').classList.add('hidden');
    notify('Não foi possível analisar este IPA.');
  }
}
$('#homeImport').addEventListener('click', () => { navigate('inspect'); $('#ipaFile').click(); });
$('#chooseFile').addEventListener('click', () => $('#ipaFile').click());
$('#ipaFile').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) inspectFile(file); event.target.value = ''; });
$('#saveIpa').addEventListener('click', () => { if (state.file) downloadBlob(state.file, state.file.name); });
$('#shareIpa').addEventListener('click', async () => {
  if (!state.file) return;
  await shareOrDownload(state.file, state.file.name, 'Original IPA package');
});

$('#extractApp').addEventListener('click', async () => {
  if (!state.file || !state.appPrefix) return;
  const button = $('#extractApp'); button.disabled = true; button.textContent = 'Extraindo…';
  try {
    const appDir = state.appPrefix.replace(/\/$/, '');
    const appName = appDir.split('/').pop();
    const selected = state.entries.filter(entry => entry.name === `${appDir}/` || entry.name.startsWith(`${appDir}/`));
    if (!selected.some(entry => entry.name === `${appDir}/`)) {
      selected.unshift({ name: `${appDir}/`, directory: true, size: 0, crc: 0, externalAttrs: 0x41ed0010, versionMadeBy: 0x0314 });
    }
    if (!selected.some(entry => !entry.directory)) throw new Error('Nenhum arquivo foi encontrado dentro do bundle .app.');
    const mapped = selected.map(entry => ({ ...entry, name: `${appName}${entry.name.slice(appDir.length)}` }));
    const blob = await buildZipBlob(mapped, 'app');
    state.appBundleZip = blob;
    state.appBundleName = safeFileName(`${appName}.zip`);
    $('#appExportTitle').textContent = `${appName} preparado`;
    $('#appExportDescription').textContent = `${selected.filter(entry => !entry.directory).length} arquivos organizados dentro de ${appName}/. O ZIP preserva o nome e a hierarquia do bundle; descompacte-o no app Arquivos para visualizar a pasta.`;
    $('#appExportPanel').classList.remove('hidden');
    $('#fileStatus').textContent = `${appName}.app exportado com verificação CRC-32 concluída.`;
    logActivity(`${appName}.app extraído`, `${selected.length} entradas · ${formatBytes(blob.size)}`, 'extract');
    notify('Bundle .app preparado como arquivo ZIP.');
  } catch (error) { notify(`Falha ao extrair o aplicativo: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Extrair aplicativo (.app)'; }
});
$('#saveAppBundle').addEventListener('click', () => {
  if (state.appBundleZip) downloadBlob(state.appBundleZip, state.appBundleName);
});
$('#shareAppBundle').addEventListener('click', async () => {
  if (state.appBundleZip) await shareOrDownload(state.appBundleZip, state.appBundleName, 'App bundle export');
});
$('#rebuildIpa').addEventListener('click', async () => {
  if (!state.file || !state.entries.length) return;
  const button = $('#rebuildIpa'); button.disabled = true; button.textContent = 'Reconstruindo…';
  try {
    const blob = await buildZipBlob(state.entries, 'ipa');
    const baseName = (state.file.name || 'application.ipa').replace(/\.ipa$/i, '');
    state.rebuiltIpa = blob;
    state.rebuiltIpaName = safeFileName(`${baseName}-rebuilt.ipa`);
    $('#rebuiltTitle').textContent = `${state.rebuiltIpaName} pronto`;
    $('#rebuiltDescription').textContent = `${state.entries.length} entradas · ${formatBytes(blob.size)}. O contêiner ZIP foi reconstruído sem alterar intencionalmente o conteúdo dos arquivos.`;
    $('#rebuiltPanel').classList.remove('hidden');
    $('#fileStatus').textContent = 'IPA reconstruído; todas as entradas passaram pela verificação CRC-32.';
    logActivity(state.rebuiltIpaName, `${state.entries.length} entradas · ${formatBytes(blob.size)}`, 'rebuild');
    notify('Arquivo IPA reconstruído. A instalação ainda depende de assinatura e provisionamento válidos.');
  } catch (error) { notify(`Não foi possível reconstruir o IPA: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Reconstruir IPA'; }
});
$('#saveRebuiltIpa').addEventListener('click', () => {
  if (state.rebuiltIpa) downloadBlob(state.rebuiltIpa, state.rebuiltIpaName);
});
$('#shareRebuiltIpa').addEventListener('click', async () => {
  if (state.rebuiltIpa) await shareOrDownload(state.rebuiltIpa, state.rebuiltIpaName, 'Reconstructed IPA');
});

$('#removeFile').addEventListener('click', () => { state.file = null; state.entries = []; state.info = null; state.appPrefix = ''; state.appBundleZip = null; state.rebuiltIpa = null; $('#appExportPanel').classList.add('hidden'); $('#rebuiltPanel').classList.add('hidden'); $('#filePanel').classList.add('hidden'); $('#extractApp').disabled = true; $('#rebuildIpa').disabled = true; $('#progressBar').style.background = '#54a9ff'; notify('Arquivo removido da sessão.'); });
const dropzone = $('#dropzone');
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('dragging'); const file = event.dataTransfer.files?.[0]; if (file) inspectFile(file); });

function renderEntries() {
  const query = ($('#entrySearch').value || '').toLowerCase(); const filter = $('#entryFilter').value;
  const filtered = state.entries.filter(entry => {
    const type = detectEntryType(entry.name);
    return (!query || entry.name.toLowerCase().includes(query)) && (filter === 'all' || (filter === 'app' && type === 'app') || (filter === type));
  });
  const shown = filtered.slice(0, 700);
  $('#entryList').innerHTML = shown.map((entry, index) => {
    const type = detectEntryType(entry.name); const symbol = type === 'signature' ? '✓' : type === 'plist' ? '≡' : type === 'framework' ? '◇' : type === 'app' ? '▣' : '·';
    return `<div class="entry-row"><span class="entry-type">${symbol}</span><div class="entry-info"><b title="${escapeHTML(entry.name)}">${escapeHTML(entry.name)}</b><small>${entry.method === 0 ? 'STORE' : entry.method === 8 ? 'DEFLATE' : `MÉTODO ${entry.method}`} · CRC ${crcHex(entry.crc)}</small></div><span class="entry-size">${formatBytes(entry.size)}</span><button class="entry-open" data-entry-index="${state.entries.indexOf(entry)}" aria-label="Detalhes">›</button></div>`;
  }).join('') || '<div class="empty-state compact"><span class="empty-icon">⌕</span><div><b>Nenhum arquivo correspondente</b><small>Altere o filtro ou a busca.</small></div></div>';
  if (filtered.length > shown.length) $('#entryList').insertAdjacentHTML('beforeend', `<div class="hint">Exibindo ${shown.length} de ${filtered.length} arquivos para preservar a fluidez do iPhone. Refine a busca para localizar outros itens.</div>`);
  $$('[data-entry-index]').forEach(button => button.addEventListener('click', () => openEntry(state.entries[Number(button.dataset.entryIndex)])));
}
$('#entrySearch').addEventListener('input', renderEntries); $('#entryFilter').addEventListener('change', renderEntries);

function openEntry(entry) {
  state.currentEntry = entry; $('#entryTitle').textContent = entryLabel(entry.name);
  const details = [['Caminho', entry.name], ['Tamanho original', formatBytes(entry.size)], ['Tamanho compactado', formatBytes(entry.compressedSize)], ['Método', entry.method === 0 ? 'STORE (sem compressão)' : entry.method === 8 ? 'Deflate' : entry.method], ['CRC-32 esperado', crcHex(entry.crc)], ['Criptografado', entry.flags & 1 ? 'Sim' : 'Não']];
  $('#entryDetails').innerHTML = details.map(([key,value]) => `<div class="detail-line"><span>${escapeHTML(key)}</span><b>${escapeHTML(value)}</b></div>`).join('');
  $('#downloadEntry').disabled = false;
  const canShare = typeof navigator.share === 'function' && typeof File === 'function';
  $('#shareEntry').classList.toggle('hidden', !canShare);
  $('#entryDialog').showModal();
}
async function entryBlob(entry) {
  const bytes = await ZIP.read(state.file, entry);
  const actual = crc32(bytes);
  if (actual !== entry.crc) throw new Error(`CRC-32 não confere. Esperado ${crcHex(entry.crc)}, obtido ${crcHex(actual)}.`);
  return new Blob([bytes], { type: mimeFor(entry.name) });
}
function mimeFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ({plist:'application/xml',json:'application/json',txt:'text/plain',xml:'application/xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',html:'text/html',css:'text/css',js:'text/javascript',pdf:'application/pdf',ipa:'application/octet-stream',mobileprovision:'application/octet-stream'}[ext] || 'application/octet-stream');
}
// ZIP32 writer. It rebuilds archives with STORE compression and preserves Unix
// external attributes (including executable and symlink mode bits) where present.
// The resulting file is a valid ZIP container, but this is not a code-signing step.
const EXPORT_LIMIT = 400 * 1024 * 1024;
function validateZipPath(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\\') || name.includes('\0')) {
    throw new Error(`Caminho ZIP inseguro ou inválido: ${String(name).slice(0, 100)}`);
  }
  if (name.split('/').some(part => part === '..')) throw new Error(`Caminho ZIP contém tentativa de sair da pasta: ${name}`);
  return name;
}
function writeZipLocalHeader(nameBytes, crc, size, modTime, modDate) {
  const bytes = new Uint8Array(30 + nameBytes.length); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true); view.setUint16(10, modTime, true); view.setUint16(12, modDate, true);
  view.setUint32(14, crc, true); view.setUint32(18, size, true); view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true); bytes.set(nameBytes, 30);
  return bytes;
}
function writeZipCentralHeader(entry, nameBytes, crc, size, localOffset) {
  const bytes = new Uint8Array(46 + nameBytes.length); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, Number.isInteger(entry.versionMadeBy) ? entry.versionMadeBy : 0x0314, true);
  view.setUint16(6, 20, true); view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true);
  view.setUint16(12, entry.modTime || 0, true); view.setUint16(14, entry.modDate || 0, true);
  view.setUint32(16, crc, true); view.setUint32(20, size, true); view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true);
  view.setUint16(34, 0, true); view.setUint16(36, entry.internalAttrs || 0, true);
  view.setUint32(38, Number.isInteger(entry.externalAttrs) ? entry.externalAttrs : (entry.directory ? 0x41ed0010 : 0x81a40000), true);
  view.setUint32(42, localOffset, true); bytes.set(nameBytes, 46);
  return bytes;
}
async function buildZipBlob(inputEntries, kind) {
  if (!Array.isArray(inputEntries) || !inputEntries.length) throw new Error('Não há arquivos para empacotar.');
  if (inputEntries.length > 65534) throw new Error('O pacote tem entradas demais para ZIP32.');
  const encoder = new TextEncoder(); const localParts = []; const centralParts = [];
  let localOffset = 0, centralSize = 0, totalSize = 0;
  const seen = new Set();
  for (let index = 0; index < inputEntries.length; index++) {
    const entry = inputEntries[index];
    const name = validateZipPath(entry.name);
    if (seen.has(name)) throw new Error(`O pacote contém um caminho duplicado: ${name}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    if (!nameBytes.length || nameBytes.length > 65535) throw new Error('Um caminho do pacote excede o limite do formato ZIP.');
    let data = entry.directory ? new Uint8Array() : await ZIP.read(state.file, entry);
    if (data.byteLength !== entry.size) throw new Error(`Tamanho incorreto durante a reconstrução: ${name}`);
    const actualCrc = crc32(data);
    if (actualCrc !== entry.crc) throw new Error(`CRC-32 inválido em ${name}. A reconstrução foi interrompida.`);
    totalSize += data.byteLength;
    if (totalSize > EXPORT_LIMIT) throw new Error(`O conteúdo descompactado ultrapassa ${formatBytes(EXPORT_LIMIT)}. Exportação bloqueada para proteger a memória do iPhone.`);
    if (localOffset > 0xffffffff || totalSize > 0xffffffff) throw new Error('O pacote excede os limites do formato ZIP32.');
    const crc = actualCrc >>> 0;
    const localHeader = writeZipLocalHeader(nameBytes, crc, data.byteLength, entry.modTime || 0, entry.modDate || 0);
    const centralHeader = writeZipCentralHeader(entry, nameBytes, crc, data.byteLength, localOffset);
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    localOffset += localHeader.byteLength + data.byteLength;
    centralSize += centralHeader.byteLength;
    if (index === inputEntries.length - 1 || (index + 1) % 20 === 0) {
      const label = kind === 'app' ? 'Extraindo bundle' : 'Reconstruindo IPA';
      $('#fileStatus').textContent = `${label}: ${index + 1}/${inputEntries.length} entradas · ${formatBytes(totalSize)}`;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  const centralOffset = localOffset;
  if (centralOffset + centralSize > 0xffffffff) throw new Error('O índice ZIP ultrapassa o limite do formato ZIP32.');
  const end = new Uint8Array(22); const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true);
  view.setUint16(8, inputEntries.length, true); view.setUint16(10, inputEntries.length, true);
  view.setUint32(12, centralSize, true); view.setUint32(16, centralOffset, true); view.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], safeFileName(filename), { type: blob.type || 'application/octet-stream' });
  try {
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || file.name });
      return;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.warn('Native share unavailable; falling back to download:', error);
  }
  downloadBlob(blob, filename);
  notify('Compartilhamento de arquivos indisponível: arquivo enviado para Downloads/Arquivos.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeFileName(filename); anchor.style.display = 'none'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('#downloadEntry').addEventListener('click', async () => {
  const button = $('#downloadEntry'); if (!state.currentEntry || !state.file) return;
  button.disabled = true; button.textContent = 'Extraindo…';
  try { const blob = await entryBlob(state.currentEntry); downloadBlob(blob, safeFileName(state.currentEntry.name)); notify('Arquivo extraído. Confira Downloads/Arquivos.'); }
  catch (error) { notify(`Falha ao extrair: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Exportar arquivo'; }
});
$('#shareEntry').addEventListener('click', async () => {
  if (!state.currentEntry || !state.file) return;
  try {
    const blob = await entryBlob(state.currentEntry); const file = new File([blob], safeFileName(state.currentEntry.name), { type: blob.type });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) throw new Error('Compartilhamento de arquivos não disponível neste navegador.');
    await navigator.share({ files: [file], title: file.name });
  } catch (error) { if (error.name !== 'AbortError') notify(`Não foi possível compartilhar: ${error.message}`); }
});

$('#hashButton').addEventListener('click', async () => {
  if (!state.file) return;
  if (!crypto?.subtle) { notify('Web Crypto indisponível. Abra o IPA Manager em HTTPS.'); return; }
  if (state.file.size > 300 * 1024 * 1024) { notify('SHA-256 local está limitado a arquivos de até 300 MB nesta versão para evitar falta de memória.'); return; }
  const button = $('#hashButton'); button.disabled = true; button.textContent = 'Calculando…'; $('#fileStatus').textContent = 'Calculando SHA-256 do arquivo completo…';
  try {
    const data = await state.file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', data);
    state.hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    $('#hashValue').textContent = state.hash; $('#hashResult').classList.remove('hidden');
    if (!$('#expectedHash')) {
      const compare = document.createElement('div'); compare.className = 'hash-result'; compare.innerHTML = '<input id="expectedHash" aria-label="Hash de referência" placeholder="Cole aqui o SHA-256 oficial" style="flex:1;min-width:160px;background:#09111b;border:1px solid #30435a;border-radius:8px;color:#dbeafe;padding:8px;font:9px monospace"><button id="compareHash" class="secondary-button">Comparar</button><span id="compareStatus"></span>';
      $('#hashResult').after(compare);
      $('#compareHash').addEventListener('click', () => {
        const expected = $('#expectedHash').value.trim().toLowerCase().replace(/^sha256:/,'');
        const valid = /^[a-f0-9]{64}$/.test(expected);
        $('#compareStatus').textContent = !valid ? 'Hash de referência inválido' : expected === state.hash ? '✓ Correspondência' : '✕ Não corresponde';
        $('#compareStatus').style.color = !valid ? '#ffcc82' : expected === state.hash ? '#4be0ac' : '#ff858d';
        if (valid) { state.checks++; persist(); logActivity('Verificação SHA-256', expected === state.hash ? 'Hash correspondente' : 'Hash divergente', 'check'); }
      });
    }
    $('#fileStatus').textContent = 'SHA-256 calculado. Compare com um hash publicado por uma fonte confiável.';
  } catch (error) { notify(`Falha no SHA-256: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Calcular hash'; }
});
$('#copyHash').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.hash); notify('SHA-256 copiado.'); } catch { notify('Não foi possível copiar automaticamente.'); } });

// GitHub Releases browser for arbitrary public repositories.
function normalizeRepo(value) {
  const trimmed = value.trim().replace(/^https?:\/\/(www\.)?github\.com\//,'').replace(/\.git$/,'').replace(/\/$/,'');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) throw new Error('Use o formato proprietário/repositório, por exemplo NuvioMedia/NuvioMobile.');
  return trimmed;
}
async function searchRepo(repo) {
  $('#releaseResults').innerHTML = '<div class="empty-state"><span class="empty-icon">◌</span><b>Consultando GitHub…</b><small>Buscando releases e arquivos publicados.</small></div>';
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=8`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'Repositório ou releases não encontrados. Confira se o repositório é público.' : `GitHub respondeu HTTP ${response.status}. Tente novamente mais tarde.`);
    const releases = await response.json();
    if (!Array.isArray(releases) || !releases.length) { $('#releaseResults').innerHTML = '<div class="empty-state"><b>Nenhuma release publicada</b><small>Este repositório não possui releases públicas.</small></div>'; return; }
    $('#releaseResults').innerHTML = releases.map((release,index) => {
      const assets = (release.assets || []).filter(asset => /\.(ipa|zip)$/i.test(asset.name));
      const assetMarkup = assets.length ? assets.map(asset => {
        const downloadUrl = safeDownloadUrl(asset.browser_download_url);
        const direct = downloadUrl ? '<a href="' + escapeHTML(downloadUrl) + '" target="_blank" rel="noopener noreferrer">Link direto ↗</a>' : '<span class="hint">URL indisponível</span>';
        const button = downloadUrl ? '<button type="button" class="secondary-button" data-download-url="' + escapeHTML(downloadUrl) + '" data-download-name="' + escapeHTML(asset.name) + '">Baixar no IPA Manager</button>' : '';
        return '<div class="asset-row"><b>' + escapeHTML(asset.name) + '</b><small>' + formatBytes(asset.size) + '</small><div class="asset-actions">' + button + direct + '</div></div>';
      }).join('') : '<small style="color:#71859e;font-size:10px">Nenhum arquivo IPA/ZIP nesta release.</small>';
      return '<article class="release-card"><div class="release-top"><div class="release-title"><b>' + escapeHTML(release.name || release.tag_name) + '</b><small>' + escapeHTML(repo) + ' · ' + escapeHTML(release.tag_name) + ' · ' + (release.published_at ? new Date(release.published_at).toLocaleDateString('pt-BR') : 'Data não informada') + (release.prerelease ? ' · Pré-lançamento' : '') + '</small></div><span class="release-badge">' + assets.length + ' pacote(s)</span></div>' + (release.body ? '<p style="font-size:10px;color:#8a9bb0;line-height:1.6;max-height:55px;overflow:hidden">' + escapeHTML(release.body.slice(0,260)) + (release.body.length > 260 ? '…' : '') + '</p>' : '') + '<div class="asset-list">' + assetMarkup + '</div></article>';
    }).join('');
    logActivity('Consulta GitHub', `${repo} · ${releases.length} releases`, 'source');
  } catch (error) {
    $('#releaseResults').innerHTML = `<div class="empty-state"><b>Não foi possível consultar</b><small>${escapeHTML(error.message)}</small></div>`;
    notify(error.message);
  }
}
$('#searchRepo').addEventListener('click', () => { try { const repo = normalizeRepo($('#repoInput').value); searchRepo(repo); } catch (error) { notify(error.message); } });
$('#repoInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('#searchRepo').click(); });
$$('[data-repo]').forEach(button => button.addEventListener('click', () => { $('#repoInput').value = button.dataset.repo; searchRepo(button.dataset.repo); }));

// AltStore-compatible JSON sources. This is catalog discovery only, not proof of Apple marketplace authorization.
async function addSource(url) {
  let parsed;
  try { const parsedUrl = new URL(url); if (parsedUrl.protocol !== 'https:') throw new Error('Por segurança, a fonte precisa usar HTTPS.'); }
  catch (error) { notify(error.message || 'URL inválida.'); return; }
  if (state.sources.some(source => source.url === url)) { notify('Esta fonte já está salva.'); return; }
  try {
    notify('Consultando catálogo…');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Não foi possível abrir a fonte (HTTP ${response.status}).`);
    parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.apps)) throw new Error('JSON não segue a estrutura esperada de uma fonte AltStore (apps[] ausente).');
    const record = { url, name: String(parsed.name || 'Fonte sem nome').slice(0,100), subtitle: String(parsed.subtitle || '').slice(0,180), apps: parsed.apps.map(app => ({ name: String(app.name || 'App sem nome'), bundleIdentifier: String(app.bundleIdentifier || ''), developerName: String(app.developerName || ''), iconURL: safeHttps(app.iconURL), versions: Array.isArray(app.versions) ? app.versions.slice(0,50).map(v => ({ version: String(v.version || ''), buildVersion: String(v.buildVersion || ''), date: v.date || '', downloadURL: safeHttps(v.downloadURL), size: Number(v.size) || 0, sha256: String(v.sha256 || ''), minOSVersion: String(v.minOSVersion || '') })) : [] })) };
    state.sources.unshift(record); persist(); renderSources(); renderLibrary();
    logActivity('Fonte adicionada', record.name, 'source');
    notify(`Fonte “${record.name}” adicionada.`);
  } catch (error) { notify(error.message || 'Não foi possível ler o catálogo.'); }
}
function safeHttps(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } }
function safeDownloadUrl(value) { try { return validateDownloadUrl(value); } catch { return ''; } }
let activeDownloadController = null;
function updateDownloadProgress(progress) {
  const bar = $('#downloadProgress');
  if (progress.total && progress.percent !== null) { bar.max = 100; bar.value = Math.max(0, Math.min(100, progress.percent)); }
  else bar.removeAttribute('value');
  $('#downloadBytes').textContent = progress.total ? formatBytes(progress.loaded) + ' / ' + formatBytes(progress.total) : formatBytes(progress.loaded) + ' recebidos';
}
async function startRemoteDownload(url, filename) {
  const safeUrl = safeDownloadUrl(url);
  if (!safeUrl) { notify('O endereço de download não passou pela validação HTTPS.'); return; }
  if (activeDownloadController) { notify('Já existe um download em andamento.'); return; }
  const controller = new AbortController();
  activeDownloadController = controller;
  const panel = $('#downloadPanel');
  const progress = $('#downloadProgress');
  const cancel = $('#cancelDownload');
  const directLink = $('#directDownloadLink');
  panel.classList.remove('hidden');
  $('#downloadTitle').textContent = 'Preparando download';
  $('#downloadStatus').textContent = 'Conectando ao servidor e verificando o pacote…';
  $('#downloadBytes').textContent = '0 B';
  progress.max = 100; progress.value = 0;
  cancel.classList.remove('hidden'); cancel.disabled = false;
  directLink.href = safeUrl; directLink.classList.add('hidden');
  try {
    const result = await downloadRemoteArchive(safeUrl, { signal: controller.signal, onProgress: updateDownloadProgress });
    const safeName = safeFileName(filename || 'application.ipa');
    downloadBlob(result.blob, safeName);
    $('#downloadTitle').textContent = 'Download concluído';
    $('#downloadStatus').textContent = safeName + ' foi recebido e passou pela verificação da assinatura ZIP.';
    $('#downloadBytes').textContent = formatBytes(result.bytes);
    progress.max = 100; progress.value = 100;
    directLink.classList.add('hidden');
    logActivity('Download concluído', safeName + ' · ' + formatBytes(result.bytes), 'download');
    notify('Download concluído. Confira Downloads/Arquivos.');
  } catch (error) {
    if (error.name === 'AbortError') {
      $('#downloadTitle').textContent = 'Download cancelado';
      $('#downloadStatus').textContent = 'A transferência foi interrompida. Nenhum arquivo foi salvo.';
      notify('Download cancelado.');
    } else {
      $('#downloadTitle').textContent = 'Não foi possível baixar pelo IPA Manager';
      $('#downloadStatus').textContent = error.message || 'Falha durante o download.';
      directLink.textContent = 'Tentar download direto ↗'; directLink.classList.remove('hidden');
      notify('Download interno indisponível. Você pode tentar o link direto.');
    }
  } finally {
    if (activeDownloadController === controller) activeDownloadController = null;
    cancel.classList.add('hidden'); cancel.disabled = false;
  }
}
$('#cancelDownload').addEventListener('click', () => { if (activeDownloadController) activeDownloadController.abort(); });
document.addEventListener('click', event => {
  const button = event.target.closest('[data-download-url]');
  if (!button || button.disabled) return;
  event.preventDefault();
  startRemoteDownload(button.dataset.downloadUrl, button.dataset.downloadName);
});

$('#addSource').addEventListener('click', () => addSource($('#sourceUrl').value.trim()));
$('#sourceUrl').addEventListener('keydown', event => { if (event.key === 'Enter') $('#addSource').click(); });
$('#addNuvio').addEventListener('click', () => addSource(NUVIO_SOURCE));
function renderSources() {
  $('#sourceCount').textContent = `${state.sources.length} ${state.sources.length === 1 ? 'fonte' : 'fontes'}`;
  if (!state.sources.length) { $('#sourcesList').innerHTML = '<div class="empty-state compact"><span class="empty-icon">◎</span><div><b>Sem fontes adicionadas</b><small>Adicione um catálogo público para listar aplicativos.</small></div></div>'; return; }
  $('#sourcesList').innerHTML = state.sources.map((source,index) => `<article class="source-card"><div class="source-logo">${escapeHTML((source.name[0] || 'S').toUpperCase())}</div><div class="source-copy"><b>${escapeHTML(source.name)}</b><small>${escapeHTML(source.subtitle || source.url)}</small><small>${source.apps.length} aplicativo(s) · ${escapeHTML(source.url)}</small></div><div class="source-actions"><button class="secondary-button" data-source-apps="${index}">Ver apps</button><button class="icon-button" data-source-delete="${index}" aria-label="Excluir fonte">×</button></div><div class="source-apps hidden" id="source-apps-${index}" style="width:100%;flex-basis:100%"></div></article>`).join('');
  $$('[data-source-delete]').forEach(button => button.addEventListener('click', () => { state.sources.splice(Number(button.dataset.sourceDelete),1); persist(); renderSources(); renderLibrary(); notify('Fonte removida.'); }));
  $$('[data-source-apps]').forEach(button => button.addEventListener('click', () => { const index = Number(button.dataset.sourceApps); const panel = $(`#source-apps-${index}`); panel.classList.toggle('hidden'); if (!panel.dataset.rendered) { panel.innerHTML = renderSourceApps(state.sources[index]); panel.dataset.rendered='1'; bindSourceActions(panel,index); } }));
}
function renderSourceApps(source) {
  if (!source.apps.length) return '<p class="hint">Esta fonte não lista aplicativos.</p>';
  return source.apps.map((app, appIndex) => {
    const version = app.versions[0] || {};
    const downloadUrl = safeDownloadUrl(version.downloadURL);
    const downloadName = safeFileName(app.name + '-' + (version.version || 'latest') + '.ipa');
    const downloadButton = downloadUrl ? '<button type="button" class="secondary-button" data-download-url="' + escapeHTML(downloadUrl) + '" data-download-name="' + escapeHTML(downloadName) + '">Baixar no IPA Manager</button><a class="text-button" target="_blank" rel="noopener noreferrer" href="' + escapeHTML(downloadUrl) + '">Link direto ↗</a>' : '<span class="hint">Download indisponível</span>';
    const versionDetails = (version.sha256 ? 'SHA-256 publicado: ' + escapeHTML(version.sha256) : 'Esta versão não publica hash SHA-256.') + (version.minOSVersion ? ' · iOS mínimo declarado ' + escapeHTML(version.minOSVersion) : '');
    return '<div class="library-row"><div class="row-details"><b>' + escapeHTML(app.name) + '</b><small>' + escapeHTML(app.developerName) + ' · ' + escapeHTML(version.version || 'Versão não informada') + ' · ' + formatBytes(version.size) + '</small><small>' + escapeHTML(app.bundleIdentifier) + '</small></div>' + downloadButton + '<button class="text-button" data-version-info="' + appIndex + '">Detalhes</button></div><div class="hint" style="margin:0 0 12px">' + versionDetails + '</div>';
  }).join('');
}
function bindSourceActions(panel, sourceIndex) {
  $$('[data-version-info]', panel).forEach(button => button.addEventListener('click', () => {
    const app = state.sources[sourceIndex].apps[Number(button.dataset.versionInfo)];
    const version = app.versions[0] || {};
    notify(`${app.name}: ${app.bundleIdentifier || 'Bundle ID não informado'} · ${version.version || 'versão desconhecida'}`);
  }));
}

function renderRecent() {
  const rows = state.activity.slice(0,5);
  $('#recentList').innerHTML = rows.length ? rows.map(item => `<div class="library-row"><span class="entry-type">${item.kind==='check'?'✓':item.kind==='source'?'◎':'▤'}</span><div class="row-details"><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.detail)}</small></div><small>${new Date(item.date).toLocaleDateString('pt-BR')}</small></div>`).join('') : '<div class="empty-state compact"><span class="empty-icon">◌</span><div><b>Nenhuma atividade ainda</b><small>Importe um IPA ou adicione uma fonte para começar.</small></div></div>';
}
function renderLibrary() {
  const content = $('#libraryContent'); if (!content) return;
  if (state.libraryTab === 'packages') {
    content.innerHTML = state.packages.length ? state.packages.map(pkg => `<div class="library-row"><span class="entry-type">IPA</span><div class="row-details"><b>${escapeHTML(pkg.name)}</b><small>${escapeHTML(pkg.bundleId || 'Bundle ID não identificado')} · ${escapeHTML(pkg.version || 'Versão não identificada')} · ${formatBytes(pkg.size)}</small></div><small>${new Date(pkg.date).toLocaleDateString('pt-BR')}</small></div>`).join('') : '<div class="empty-state"><span class="empty-icon">▣</span><b>Sua biblioteca está vazia</b><small>Os metadados dos IPA analisados aparecem aqui. O arquivo original não é guardado automaticamente.</small></div>';
  } else if (state.libraryTab === 'sources') {
    content.innerHTML = state.sources.length ? state.sources.map(source => `<div class="library-row"><span class="entry-type">◎</span><div class="row-details"><b>${escapeHTML(source.name)}</b><small>${escapeHTML(source.url)} · ${source.apps.length} aplicativo(s)</small></div></div>`).join('') : '<div class="empty-state"><b>Nenhuma fonte salva</b><small>Adicione catálogos na seção Fontes.</small></div>';
  } else {
    content.innerHTML = state.activity.length ? state.activity.map(item => `<div class="library-row"><span class="entry-type">${item.kind==='check'?'✓':item.kind==='source'?'◎':'▤'}</span><div class="row-details"><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.detail)}</small></div><small>${new Date(item.date).toLocaleString('pt-BR')}</small></div>`).join('') : '<div class="empty-state"><b>Sem atividade</b><small>As ações realizadas aparecerão aqui.</small></div>';
  }
}
$$('[data-library-tab]').forEach(button => button.addEventListener('click', () => {
  state.libraryTab = button.dataset.libraryTab;
  $$('[data-library-tab]').forEach(tab => tab.classList.toggle('active', tab === button)); renderLibrary();
}));
$('#clearHistory').addEventListener('click', () => {
  if (!confirm('Apagar registros de pacotes, verificações e atividade deste navegador? As fontes salvas serão mantidas.')) return;
  state.packages = []; state.activity = []; state.checks = 0; persist(); renderRecent(); renderLibrary(); notify('Histórico local apagado.');
});

// Keep the app shell available offline after the first visit. External catalogs remain online resources.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error)));
}
loadSaved();
