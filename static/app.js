/* ═══════════════════════════════════════════════
   KGVN Poster Changer — Client Logic
═════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  authMode: 'link',
  linkStr: '',
  harData: null,
  tokenData: null,
  posterType: 'player',
  imgOrigBlob: null,
  imgDataUrl: null,
  stats: { ok: 0, fail: 0 },
};

// ── Logging ────────────────────────────────────────────────────────────────
function log(type, msg) {
  const el = document.getElementById('termBody');
  const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const icons = { ok: '✅', err: '❌', info: 'ℹ️', warn: '⚠️', gold: '⭐', dim: '▫️' };
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span class="log-ts">[${ts}]</span><span class="log-msg">${icons[type]||''} ${msg}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

const logOk = m => log('ok', m);
const logErr = m => log('err', m);
const logInf = m => log('info', m);
const logWarn = m => log('warn', m);
const logGold = m => log('gold', m);
const logDim = m => log('dim', m);

function clearLog() {
  document.getElementById('termBody').innerHTML = '';
}

// ── Progress ───────────────────────────────────────────────────────────────
function setProgress(pct, label) {
  const wrap = document.getElementById('progressWrap');
  wrap.classList.add('visible');
  document.getElementById('progressBar').style.width = pct + '%';
  if (label) document.getElementById('progressLabel').textContent = label;
}

// ── Auth modes ─────────────────────────────────────────────────────────────
function setAuthMode(mode, btn) {
  document.querySelectorAll('.card .card-body .seg-group:first-of-type .seg-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  state.authMode = mode;
  document.getElementById('linkPanel').style.display = mode === 'link' ? 'block' : 'none';
  document.getElementById('harPanel').style.display = mode === 'har' ? 'block' : 'none';
  document.getElementById('tokenPanel').style.display = mode === 'token' ? 'block' : 'none';
}

function parseTokenInput() {
  const raw = document.getElementById('tokenInput').value;
  const trimmed = raw.trim();

  // Detect hex-only input (msdk-itopencodeparam alone)
  if (isHexOnly(trimmed)) {
    state.tokenData = { _msdkOnly: true, _msdkToken: trimmed };
    const badge = document.getElementById('detectBadge');
    badge.textContent = `✅ Nhận diện mã MSDK (${trimmed.slice(0, 16)}...)`;
    badge.classList.add('visible');
    logOk(`Mã MSDK: ${trimmed.slice(0, 16)}... — dùng chế độ server-side`);
    return;
  }

  const lines = raw.split('\n').filter(l => l.includes(':') || l.includes('='));
  const parsed = {};
  for (const line of lines) {
    const sep = line.includes('=') ? '=' : ':';
    const idx = line.indexOf(sep);
    if (idx < 0) continue;
    let k = line.slice(0, idx).trim().toLowerCase().replace(/^["']|["']$/g, '');
    let v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '').replace(/,$/, '');
    if (!k || !v) continue;
    if (k === 'access_token' || k === 'access-token' || k === 'token') parsed.accessToken = v;
    else if (k === 'msdk-itopencodeparam') parsed.itopencodeparam = v;
    else if (k === 'msdk-channelid' || k === 'channelid') parsed.channelid = v;
    else if (k === 'msdk-gameid' || k === 'gameid') parsed.gameid = v;
    else if (k === 'msdk-os') parsed.os = v;
    else if (k === 'logicworldid' || k === 'partition') parsed.partition = v;
    else if (k === 'areaid') parsed.areaid = v;
    else if (k === 'aov-region' || k === 'aov_region') parsed.region = v;
    else if (k === 'aov-language' || k === 'lang') parsed.lang = v;
    else if (k === 'user-agent' || k === 'useragent') parsed.ua = v;
    else if (k === 'encodeparam') parsed.encodeparam = v;
    else if (k === 'sig') parsed.sig = v;
    else if (k === 'seq') parsed.seq = v;
  }
  if (!parsed.accessToken) {
    // Try to find access_token in URL-like patterns
    const m = raw.match(/access_token=([a-f0-9]{40,})/i);
    if (m) parsed.accessToken = m[1];
  }
  if (!parsed.accessToken) {
    logErr('Không tìm thấy access_token trong dữ liệu dán vào');
    return;
  }
  state.tokenData = parsed;
  const badge = document.getElementById('detectBadge');
  const hasEp = parsed.encodeparam || parsed.itopencodeparam;
  badge.textContent = `✅ Token: ${parsed.accessToken.slice(0,16)}...${hasEp ? ' · có encodeparam' : ' · thiếu encodeparam'}`;
  badge.classList.add('visible');
  logOk(`Parse token OK: ${parsed.accessToken.slice(0,16)}...${parsed.encodeparam ? ' + encodeparam' : ''}`);
  if (parsed.encodeparam) {
    document.getElementById('encInput').value = parsed.encodeparam;
  }
}

function setMode(mode, btn) {
  document.querySelectorAll('.card:last-of-type .seg-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  state.posterType = mode;
  document.getElementById('encPanel').classList.toggle('visible', mode === 'flowborn');
}

// ── Link parser ────────────────────────────────────────────────────────────
function parseLinkInput(val) {
  state.linkStr = val.trim();
  const badge = document.getElementById('detectBadge');
  if (!val) { badge.classList.remove('visible'); return; }
  try {
    const url = new URL(val);
    const token = url.searchParams.get('access_token') || new URLSearchParams(url.hash.replace('#','')).get('access_token');
    if (token) {
      const isFb = val.includes('flowborn');
      badge.textContent = `✅ Detected: ${isFb ? 'Flowborn' : 'Player'} Poster · Token: ${token.slice(0,12)}...`;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  } catch {
    badge.classList.remove('visible');
  }
}

// ── HAR parser ─────────────────────────────────────────────────────────────
const KEEP_HEADERS = new Set([
  'msdk-channelid','camp-source','logicworldid','user-agent','msdk-gameid',
  'msdk-itopencodeparam','areaid','aov-region','aov-language','camp-authtype',
  'origin','referer','encodeparam','msdk-os'
]);

function parseHar(har) {
  const info = {
    headers: {}, accessToken: null, userId: null,
    posterPathPrefix: null, posterInfo: null,
    apiBase: 'https://kgvn-api.mobagarena.com',
    isFlowborn: false, mainJob: 5
  };
  for (const e of har.log.entries) {
    const url = e.request.url;
    if (!info.accessToken && url.includes('access_token=')) {
      const m = url.match(/access_token=([a-f0-9]{40,})/i);
      if (m) info.accessToken = m[1];
    }
    if (e.request.method === 'POST' && url.includes('kgvn-api.mobagarena.com')) {
      for (const h of e.request.headers) {
        const k = h.name.toLowerCase();
        if (KEEP_HEADERS.has(k) && !info.headers[k]) info.headers[k] = h.value;
      }
    }
    if (e.request.method === 'PUT' && url.includes('cos.ap-singapore') && !info.posterPathPrefix) {
      try {
        const p = new URL(url).pathname;
        const m = p.match(/^(\/\d+\/\d+\/[a-f0-9]+)/);
        if (m) info.posterPathPrefix = m[1];
      } catch {}
    }
    if (e.request.method === 'POST' && url.includes('saveposter')) {
      const b = e.request.postData?.text || '';
      if (b) { try { info.posterInfo = JSON.parse(b); } catch {} }
    }
    if (e.request.method === 'POST' && url.includes('getselfuserinfo') && !info.userId) {
      const r = e.response?.content?.text || '';
      if (r) {
        try {
          const d = JSON.parse(r);
          const u = d?.data?.role?.campRoleid;
          if (u) info.userId = u;
        } catch {}
      }
    }
  }
  info.isFlowborn = har.log.entries.some(e =>
    e.request.url.includes('flowborn') && e.request.url.includes('kgvn-api.mobagarena.com')
  );
  info.mainJob = info.posterInfo?.mainJob ?? 5;
  return info;
}

function handleHarFile(file) {
  if (!file) return;
  document.getElementById('harFileName').textContent = file.name;
  document.getElementById('harChip').style.display = 'inline-flex';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const har = JSON.parse(e.target.result);
      state.harData = parseHar(har);
      logOk(`HAR parsed: ${state.harData.accessToken ? 'token OK' : 'no token'}`);
      if (state.harData.isFlowborn) {
        setMode('flowborn', document.querySelector('.card:last-of-type .seg-btn:last-child'));
      }
      if (state.harData.posterInfo) {
        logDim(`Found saveposter body in HAR`);
      }
    } catch (err) {
      logErr('HAR parse error: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function handleHarDrop(e) {
  e.preventDefault();
  document.getElementById('harZone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.har')) handleHarFile(file);
  else logErr('Chỉ chấp nhận file .har');
}

function clearHar() {
  document.getElementById('harChip').style.display = 'none';
  document.getElementById('harFileInput').value = '';
  state.harData = null;
}

// ── Image handling ─────────────────────────────────────────────────────────
function handleImgFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.imgDataUrl = e.target.result;
    state.imgOrigBlob = file;
    showPreview(file);
  };
  reader.readAsDataURL(file);
}

function handleImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleImgFile(file);
}

async function loadImgFromUrl() {
  const url = document.getElementById('imgUrlInput').value.trim();
  if (!url) return;
  const loader = document.getElementById('urlLoading');
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    state.imgOrigBlob = blob;
    const reader = new FileReader();
    reader.onload = e => {
      state.imgDataUrl = e.target.result;
      showPreview(blob);
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    logErr('Tải ảnh thất bại: ' + err.message);
  }
}

function showPreview(blob) {
  const wrap = document.getElementById('imgPreviewWrap');
  wrap.style.display = 'block';
  document.getElementById('imgPreviewEl').src = state.imgDataUrl;
  document.getElementById('imgInfo').textContent =
    `${(blob.size/1024).toFixed(0)}KB · ${blob.type}`;
}

// ── COS HMAC-SHA1 Signing ─────────────────────────────────────────────────
async function hmacSha1(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(msg) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(msg));
  return [...new Uint8Array(b)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function qenc(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29')
    .replace(/\*/g,'%2A');
}

async function cosSign(sId, sKey, method, uri, sHdrs, t0, t1) {
  const kt = `${t0};${t1}`;
  const sk = await hmacSha1(sKey, kt);
  const keys = Object.keys(sHdrs).sort();
  const hl = keys.join(';');
  const hp = keys.map(k => `${qenc(k)}=${qenc(sHdrs[k])}`).join('&');
  const hs = `${method.toLowerCase()}\n${uri}\n\n${hp}\n`;
  const sh = await sha1Hex(hs);
  const ss = `sha1\n${kt}\n${sh}\n`;
  const sig = await hmacSha1(sk, ss);
  return `q-sign-algorithm=sha1&q-ak=${sId}&q-sign-time=${kt}&q-key-time=${kt}&q-header-list=${hl}&q-url-param-list=&q-signature=${sig}`;
}

// ── API ────────────────────────────────────────────────────────────────────
let _sbReady = false;
let _sbInitialized = false;

async function checkSignBridge() {
  try {
    const r = await fetch('/api/sign-bridge/status');
    const d = await r.json();
    _sbReady = d.ready;
    _sbInitialized = d.initialized;
    return d;
  } catch { return { ready: false }; }
}

async function sbInit(encryption, campRoleid) {
  const r = await fetch('/api/sign-bridge/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryption, campRoleid }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'SB init failed');
  _sbInitialized = true;
  logOk(`Sign bridge OK — test EP: ${d.testEncodeparam?.slice(0,20)}...`);
  return d;
}

async function sbSign(roleid = '') {
  const r = await fetch('/api/sign-bridge/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleid }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'SB sign failed');
  return d.encodeparam;
}

function buildApiHeaders(info, extra) {
  const base = {};
  for (const [k, v] of Object.entries(info.headers)) {
    if (v) base[k] = v;
  }
  const enc = document.getElementById('encInput')?.value?.trim();
  if (enc) base['encodeparam'] = enc;
  return {
    ...base,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    ...(extra || {}),
  };
}

async function apiPost(info, ep, body = {}) {
  const targetUrl = `${info.apiBase}${ep}?access_token=${info.accessToken}`;
  const resp = await fetch('/api/aov', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl, headers: buildApiHeaders(info), body }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.code !== 0 && data.code !== undefined) {
    if (data.error) throw new Error(`API error: ${data.error}`);
    throw new Error(`API code ${data.code}: ${data.msg || ''}`);
  }
  return data.data || data;
}

async function apiCreatePoster(info) {
  const d = await apiPost(info, '/api/game/poster/playerimage/createposter');
  return String(d.posterId);
}

async function apiGetCosCred(info, fn, scene = 'PlayerimagePoster') {
  return await apiPost(info, '/api/game/poster/getcoscredential', { scene, fileName: fn });
}

async function apiSavePoster(info, pid, cdn, pfx) {
  const body = info.posterInfo
    ? { ...info.posterInfo, posterId: pid, picUrl: `${cdn}${pfx}/`, isApply: true }
    : {
        posterId: pid, isApply: true, isShare: true,
        picUrl: `${cdn}${pfx}/`,
        picInfo: {
          bg: { id: '21', picUrl: 'https://kg-camp.mobagarena.com/manage/playerimage_official/iDzT817p.png', source: 1, width: 320, height: 503.99, posX: 0, posY: 0 },
          stickerList: [],
        },
      };
  return await apiPost(info, '/api/game/poster/playerimage/saveposter', body);
}

async function apiFbGetCfg(info) {
  const d = await apiPost(info, '/api/game/poster/flowborn/geteditorconfig', { mainJob: info.mainJob });
  const l = d.baseList || [];
  if (!l.length) throw new Error('baseList trống');
  return l[0];
}

async function apiFbSaveEdit(info, cfg) {
  await apiPost(info, '/api/game/poster/flowborn/savepostereditinfo', {
    mainJob: info.mainJob,
    picInfo: {
      bg: { id: '30', picUrl: 'https://kg-camp.mobagarena.com/manage/flowborn_official/4uxOQChv.png' },
      baseInfo: { id: cfg.id, gender: cfg.gender || 2, mainJob: info.mainJob, picUrl: cfg.picUrl, skinColor: cfg.skinColor || 1 },
      stickerList: [],
    },
  });
}

async function apiFbCreate(info) {
  const d = await apiPost(info, '/api/game/poster/flowborn/createposter');
  return String(d.posterId);
}

async function apiFbSave(info, pid, cdn, pfx, cfg) {
  const body = info.posterInfo
    ? { ...info.posterInfo, posterId: pid, picUrl: `${cdn}${pfx}/`, isApply: true }
    : {
        posterId: pid, isApply: true, isShare: false, mainJob: info.mainJob,
        picUrl: `${cdn}${pfx}/`,
        picInfo: {
          bg: { id: '30', picUrl: 'https://kg-camp.mobagarena.com/manage/flowborn_official/4uxOQChv.png' },
          baseInfo: { id: cfg.id, gender: cfg.gender || 2, mainJob: info.mainJob, picUrl: cfg.picUrl, skinColor: cfg.skinColor || 1 },
          stickerList: [],
        },
      };
  return await apiPost(info, '/api/game/poster/flowborn/saveposter', body);
}

async function uploadCos(cred, buf, ct) {
  const { bucket, appId, region, path, tmpSecretId: sId, tmpSecretKey: sKey, token, startTime, expiration } = cred;
  const t0 = parseInt(startTime);
  const t1 = /^\d+$/.test(String(expiration)) ? parseInt(expiration) : Math.floor(new Date(expiration).getTime() / 1000);
  const host = `${bucket}-${appId}.cos.${region}.myqcloud.com`;
  const sHdrs = { 'content-length': String(buf.byteLength), 'host': host, 'x-cos-forbid-overwrite': 'true' };
  const auth = await cosSign(sId, sKey, 'PUT', path, sHdrs, t0, t1);
  const targetUrl = `https://${host}${path}`;
  const resp = await fetch('/api/cos-upload', {
    method: 'PUT',
    headers: {
      'X-Cos-Target': targetUrl, 'Authorization': auth, 'x-cos-security-token': token,
      'x-cos-forbid-overwrite': 'true', 'Content-Type': ct,
      'Content-Length': String(buf.byteLength), 'Host': host,
      'Origin': 'https://kgvn-camp.mobagarena.com', 'Referer': 'https://kgvn-camp.mobagarena.com/',
    },
    body: buf,
  });
  if (![200, 204].includes(resp.status)) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`COS upload failed: ${resp.status} ${txt.slice(0,100)}`);
  }
}

// ── Run flows ──────────────────────────────────────────────────────────────
async function runPlayerFlow(info, largeBuf, thumbBuf, imgCt) {
  logInf('Tạo poster...');
  const pid = await apiCreatePoster(info);
  logOk(`Poster ID: ${pid}`);
  setProgress(30, 'Đang lấy COS credentials...');

  logInf('Lấy credential _large...');
  const cL = await apiGetCosCred(info, `0/1/${pid}_large.png`);
  logOk('Cred _large OK');
  setProgress(40, '');

  logInf('Lấy credential .png...');
  const cP = await apiGetCosCred(info, `0/1/${pid}.png`);
  logOk('Cred .png OK');
  setProgress(50, 'Đang upload ảnh lên CDN...');

  logInf('Upload _large...');
  await uploadCos(cL, largeBuf, imgCt);
  logOk('Upload _large OK');
  setProgress(65, '');

  logInf('Upload .png...');
  await uploadCos(cP, thumbBuf, 'image/png');
  logOk('Upload .png OK');
  setProgress(78, 'Đang lưu poster...');

  const cdn = cP.cdnHost || 'https://kg-camp-ugc.mobagarena.com';
  const parts = cP.path.split('/');
  const pfx = parts.slice(0, parts.length - 3).join('/') || (info.posterPathPrefix || '');
  logDim(`picUrl → ${cdn}${pfx}/`);

  const saveResp = await apiSavePoster(info, pid, cdn, pfx);
  logOk(`savePoster OK — posterUrl: ${saveResp?.posterUrl || saveResp?.picUrl || '(none)'}`);
  setProgress(100, '✅ Hoàn tất!');
  logGold(`🎉 Thành công! (Poster ID: ${pid})`);
  state.stats.ok++;
  updateStats();
}

async function runFlowbornFlow(info, largeBuf, thumbBuf, imgCt) {
  logInf(`getEditorConfig job ${info.mainJob}...`);
  const cfg = await apiFbGetCfg(info);
  logOk(`baseInfo id=${cfg.id}`);
  setProgress(20, '');

  logInf('savepostereditinfo...');
  await apiFbSaveEdit(info, cfg);
  logOk('editinfo OK');
  setProgress(28, '');

  logInf('createposter Flowborn...');
  const pid = await apiFbCreate(info);
  logOk(`Poster ID: ${pid}`);
  setProgress(35, '');

  const pfxCos = `${info.mainJob}/1`;

  logInf('Credential _large...');
  const cL = await apiGetCosCred(info, `${pfxCos}/${pid}_large.png`, 'FlowbornPoster');
  logOk('Cred _large OK');
  setProgress(44, '');

  logInf('Credential .png...');
  const cP = await apiGetCosCred(info, `${pfxCos}/${pid}.png`, 'FlowbornPoster');
  logOk('Cred .png OK');
  setProgress(52, 'Đang upload...');

  logInf('Upload _large...');
  await uploadCos(cL, largeBuf, imgCt);
  logOk('Upload _large OK');
  setProgress(65, '');

  logInf('Upload .png...');
  await uploadCos(cP, thumbBuf, 'image/png');
  logOk('Upload .png OK');
  setProgress(78, 'Đang lưu poster...');

  const cdn = cP.cdnHost || 'https://kg-camp-ugc.mobagarena.com';
  const parts = cP.path.split('/');
  const pfx = parts.slice(0, parts.length - 3).join('/');

  await apiFbSave(info, pid, cdn, pfx, cfg);
  logOk('savePoster OK');
  setProgress(100, '✅ Hoàn tất!');
  logGold(`🎉 Flowborn OK! (Poster ID: ${pid})`);
  state.stats.ok++;
  updateStats();
}

// ── Main entry ─────────────────────────────────────────────────────────────
async function run() {
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  setProgress(0, 'Đang chuẩn bị...');
  logGold('══════════════════════════════');
  logGold('   KGVN Poster Changer — Start');
  logGold('══════════════════════════════');

  try {
    // Get auth info
    let info;
    if (state.authMode === 'har') {
      if (!state.harData) throw new Error('Chưa upload file HAR');
      info = state.harData;
      info.apiBase = 'https://kgvn-api.mobagarena.com';
    } else if (state.authMode === 'token') {
      if (!state.tokenData) throw new Error('Chưa dán MSDK token');
      const t = state.tokenData;
      const ua = t.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MSDK/' + (t.version || '5.36.000.9136') + ' mQQAppId/1105779914 mWXAppId/wx7a814e3ceeda8320 mGameId/' + (t.gameid || '1137');
      info = {
        headers: {
          'msdk-channelid': t.channelid || '10',
          'camp-source': 'AOV-CAMP',
          'logicworldid': t.partition || '',
          'user-agent': ua,
          'msdk-gameid': t.gameid || '1137',
          'msdk-itopencodeparam': t.itopencodeparam || '',
          'areaid': t.areaid || '1',
          'aov-region': t.region || '',
          'aov-language': t.lang || 'VN',
          'camp-authtype': 'msdk',
          'msdk-os': t.os || '2',
          'origin': 'https://kgvn-camp.mobagarena.com',
          'referer': 'https://kgvn-camp.mobagarena.com/',
        },
        accessToken: t.accessToken,
        apiBase: 'https://kgvn-api.mobagarena.com',
        isFlowborn: state.posterType === 'flowborn',
        mainJob: parseInt(t.heroJob || '5'),
      };
    } else {
      if (!state.linkStr) throw new Error('Chưa dán link KGVN');
      const url = new URL(state.linkStr);
      const params = Object.fromEntries(url.searchParams);
      const accessToken = params.access_token || new URLSearchParams(url.hash.replace('#','')).get('access_token') || '';
      if (!accessToken) throw new Error('Không tìm thấy access_token trong link');
      const isFlowborn = state.posterType === 'flowborn' || url.pathname.includes('flowborn');
      let ua;
      if (isFlowborn) {
        ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      } else {
        const seq = params.seq || '';
        let du = '';
        if (seq) {
          const rest = seq.split('-').slice(1).join('-');
          const m = rest.match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
          if (m) du = m[1].toUpperCase();
        }
        const ver = (params.version && params.version !== 'null') ? params.version : '5.36.000.9136';
        ua = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MSDK/${ver} mQQAppId/1105779914 mWXAppId/wx7a814e3ceeda8320 mGameId/${params.gameid || '1137'}` + (du ? ` MSDKDeviceModel/${du}` : '');
      }
      info = {
        headers: {
          'msdk-channelid': params.channelid || '10',
          'camp-source': 'AOV-CAMP',
          'logicworldid': params.partition || '',
          'user-agent': ua,
          'msdk-gameid': params.gameid || '1137',
          'msdk-itopencodeparam': params.itopencodeparam || '',
          'areaid': params.aov_areaid || '1',
          'aov-region': params.aov_region || '',
          'aov-language': params.lang || 'VN',
          'camp-authtype': 'msdk',
          'msdk-os': params.os || '2',
          'origin': 'https://kgvn-camp.mobagarena.com',
          'referer': 'https://kgvn-camp.mobagarena.com/',
        },
        accessToken,
        apiBase: 'https://kgvn-api.mobagarena.com',
        isFlowborn: state.posterType === 'flowborn',
        mainJob: parseInt(params.heroJob || '5'),
      };
    }

    logOk(`Auth OK — Token: ${info.accessToken.slice(0, 16)}...`);

    // Auto-init sign bridge if ready
    try {
      const sb = await checkSignBridge();
      if (sb.ready && !sb.initialized) {
        logInf('Sign bridge sẵn sàng, đang init...');
        const encryption = info.headers?.['msdk-itopencodeparam'] || '';
        const roleId = info.userId || '';
        if (encryption) {
          await sbInit(encryption, roleId);
        } else {
          logWarn('Không tìm thấy encryption để init sign bridge');
        }
      } else if (sb.initialized) {
        logOk('Sign bridge đã init sẵn');
      }
    } catch (e) {
      logDim('Sign bridge: ' + e.message);
    }

    // Auto-generate encodeparam if sign bridge ready
    try {
      if (_sbInitialized) {
        const ep = await sbSign(info.userId || '');
        if (ep) {
          document.getElementById('encInput').value = ep;
          logOk('Tự động sinh encodeparam từ sign bridge');
        }
      }
    } catch (e) {
      logDim('Auto encodeparam: ' + e.message);
    }

    if (!state.imgOrigBlob) throw new Error('Chưa chọn ảnh');
    setProgress(5, 'Auth xong...');

    // Build thumb and large buffers
    logInf('Chuẩn bị ảnh...');
    const imgCt = state.imgOrigBlob.type.includes('png') ? 'image/png' : 'image/jpeg';
    const largeBuf = await state.imgOrigBlob.arrayBuffer();

    // Create a 400x628 thumb for the .png upload
    const thumbBlob = await resizeImage(state.imgOrigBlob, 400, 628);
    const thumbBuf = await thumbBlob.arrayBuffer();

    logOk(`Large: ${(largeBuf.byteLength/1024).toFixed(0)}KB · Thumb: ${(thumbBuf.byteLength/1024).toFixed(0)}KB`);
    setProgress(15, 'Ảnh OK...');

    if (info.isFlowborn) {
      await runFlowbornFlow(info, largeBuf, thumbBuf, imgCt);
    } else {
      await runPlayerFlow(info, largeBuf, thumbBuf, imgCt);
    }
  } catch (err) {
    logErr('❌ Lỗi: ' + err.message);
    state.stats.fail++;
    updateStats();
  } finally {
    btn.disabled = false;
  }
}

// ── Image resize helper ────────────────────────────────────────────────────
function resizeImage(blob, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => resolve(b), 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────
function updateStats() {
  const row = document.getElementById('statsRow');
  row.style.display = 'flex';
  document.getElementById('statOk').textContent = state.stats.ok;
  document.getElementById('statFail').textContent = state.stats.fail;
}

// ── Server-side MSDK flow ─────────────────────────────────────────────────
let _msdkJobId = null;
let _msdkPollTimer = null;
let _sbClientReady = false;
let _sbClientInitialized = false;

function isHexOnly(s) {
  return /^[0-9A-Fa-f]{40,}$/.test(s.trim());
}

function initClientSignBridge(hexToken) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof __TCSJ__ === 'undefined') {
        reject(new Error('Chưa load xong'));
        return;
      }
      logDim('Sign bridge methods: ' + Object.keys(__TCSJ__).join(', '));
      __TCSJ__.setLoginRes(hexToken, '');
      _sbClientInitialized = true;
      const freshEp = __TCSJ__.getEncodeParam('');
      logDim('Fresh encodeparam: ' + (freshEp || '').slice(0, 30));
      if (!freshEp || freshEp === 'encodeResponse not set!') {
        reject(new Error('Không sinh được encodeparam'));
        return;
      }
      resolve(freshEp);
    } catch (e) {
      reject(new Error(e.message));
    }
  });
}

async function uploadImgToServer(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'image.jpg');
  const resp = await fetch('/api/msdk/upload', { method: 'POST', body: fd });
  const d = await resp.json();
  if (!d.ok) throw new Error(d.error || 'Upload failed');
  return d.filename;
}

async function startMsdkJob(authToken, mediaFilename, mode, isShare, mainJob, gender, encodeparam) {
  const resp = await fetch('/api/msdk/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      media_filename: mediaFilename,
      mode: mode,
      is_share: isShare,
      main_job: mainJob || 5,
      gender: gender || 2,
      encodeparam: encodeparam || '',
    }),
  });
  const d = await resp.json();
  if (d.error) throw new Error(d.error);
  return d.job_id;
}

function pollMsdkStatus() {
  if (!_msdkJobId) return;
  fetch(`/api/msdk/status/${_msdkJobId}?from=${window._msdkLogOffset || 0}`)
    .then(r => r.json())
    .then(d => {
      if (d.logs && d.logs.length) {
        for (const e of d.logs) {
          const icon = { info: 'ℹ️', ok: '✅', error: '❌', warn: '⚠️', gold: '⭐', dim: '▫️' };
          log(e.level, e.msg);
        }
        window._msdkLogOffset = (window._msdkLogOffset || 0) + d.logs.length;
      }
      if (d.progress !== undefined) {
        setProgress(d.progress, d.progLabel || '');
      }
      if (d.done) {
        document.getElementById('statOk').textContent = d.done.ok || 0;
        document.getElementById('statFail').textContent = d.done.fail || 0;
        document.getElementById('statsRow').style.display = 'flex';
        _msdkJobId = null;
        document.getElementById('runBtn').disabled = false;
        return;
      }
      if (d.finished) {
        _msdkJobId = null;
        document.getElementById('runBtn').disabled = false;
        return;
      }
      _msdkPollTimer = setTimeout(pollMsdkStatus, 1000);
    })
    .catch(() => {
      _msdkPollTimer = setTimeout(pollMsdkStatus, 2000);
    });
}

function stopMsdkPoll() {
  if (_msdkPollTimer) { clearTimeout(_msdkPollTimer); _msdkPollTimer = null; }
}

// ── Override run() to handle MSDK hex-only token ─────────────────────────
const _origRun = run;
run = async function() {
  if (state.authMode === 'token' && state.tokenData && state.tokenData._msdkOnly) {
    // Server-side flow
    const btn = document.getElementById('runBtn');
    btn.disabled = true;
    setProgress(0, 'Đang chuẩn bị...');
    logGold('══════════════════════════════');
    logGold('   KGVN Poster Changer (Server)');
    logGold('══════════════════════════════');
    try {
      if (!state.imgOrigBlob) throw new Error('Chưa chọn ảnh');
      const mode = state.posterType || 'player';
      const isShare = true;
      const mainJob = parseInt(document.getElementById('encInput')?.value?.trim()) || 5;
      const gender = 2;

      // Process hex token via client-side sign bridge to get a fresh encodeparam
      const rawHex = state.tokenData._msdkToken;
      let freshEp = '';
      try {
        freshEp = await initClientSignBridge(rawHex);
        logOk(`Sign bridge OK — ep mới: ${freshEp.slice(0, 16)}...`);
      } catch (sbErr) {
        logWarn('Sign bridge: ' + sbErr.message + ' — dùng ep gốc');
      }

      logInf('Upload ảnh lên server...');
      setProgress(5, 'Upload ảnh...');
      const fname = await uploadImgToServer(state.imgOrigBlob);
      logOk(`Upload OK: ${fname}`);

      logInf('Khởi tạo job...');
      setProgress(10, 'Khởi tạo...');
      const jobId = await startMsdkJob(rawHex, fname, mode, isShare, mainJob, gender, freshEp);
      logOk(`Job ID: ${jobId}`);
      _msdkJobId = jobId;
      window._msdkLogOffset = 0;
      pollMsdkStatus();
    } catch (err) {
      logErr('❌ Lỗi: ' + err.message);
      document.getElementById('statFail').textContent = '1';
      document.getElementById('statsRow').style.display = 'flex';
      btn.disabled = false;
    }
    return;
  }
  await _origRun.call(this);
};

// ── Init ───────────────────────────────────────────────────────────────────
logInf('Sẵn sàng — dán link KGVN hoặc upload file HAR để bắt đầu');