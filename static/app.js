// v2.1 - UI cleanup
const state = {
  tokenData: null,
  imgOrigBlob: null,
  imgDataUrl: null,
  stats: { ok: 0, fail: 0 },
};

function log(type, msg) {
  const el = document.getElementById('logBody');
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
  document.getElementById('logBody').innerHTML = '';
}

function setProgress(pct, label) {
  const wrap = document.getElementById('progressWrap');
  wrap.classList.add('visible');
  document.getElementById('progressBar').style.width = pct + '%';
  if (label) document.getElementById('progressLabel').textContent = label;
}

function isHexOnly(s) {
  return /^[0-9A-Fa-f]{40,}$/.test(s.trim());
}

function parseTokenInput() {
  const raw = document.getElementById('tokenInput').value;
  const trimmed = raw.trim();
  if (!trimmed) { state.tokenData = null; return; }

  if (isHexOnly(trimmed)) {
    state.tokenData = { _msdkOnly: true, _msdkToken: trimmed };
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
    const m = raw.match(/access_token=([a-f0-9]{40,})/i);
    if (m) parsed.accessToken = m[1];
  }
  if (!parsed.accessToken) {
    logErr('Không tìm thấy access_token trong dữ liệu dán vào');
    return;
  }
  state.tokenData = parsed;
  logOk(`Token: ${parsed.accessToken.slice(0, 16)}...`);
}

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

async function loadImgFromUrl(url) {
  if (!url) return;
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
  const wrap = document.getElementById('previewWrap');
  wrap.style.display = 'block';
  document.getElementById('previewImg').src = state.imgDataUrl;
  document.getElementById('fileInfo').innerHTML =
    `<span class="file-chip">📄 ${blob.name||'image'} (${(blob.size/1024).toFixed(0)}KB) <span class="rm" onclick="this.parentElement.remove();document.getElementById('previewWrap').style.display='none';state.imgOrigBlob=null;state.imgDataUrl=null">×</span></span>`;
}

function updateStats() {
  const row = document.getElementById('statsRow');
  row.style.display = 'flex';
  document.getElementById('okCount').textContent = state.stats.ok;
  document.getElementById('failCount').textContent = state.stats.fail;
}

// ── Server-side MSDK flow ─────────────────────────────────────────────────
let _msdkJobId = null;
let _msdkPollTimer = null;

function initClientSignBridge(hexToken) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof __TCSJ__ === 'undefined') {
        reject(new Error('Chưa load xong __TCSJ__'));
        return;
      }
      fetch('/api/sb/getcredential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: hexToken }),
      })
        .then(r => r.json())
        .then(d => {
          if (!d.ok) { reject(new Error(d.error || 'getcredential failed')); return; }
          __TCSJ__.setLoginRes(d.encryption, d.roleId);
          const eps = [];
          for (let i = 0; i < 20; i++) {
            const ep = __TCSJ__.getEncodeParam(d.roleId);
            if (!ep || ep === 'encodeResponse not set!') break;
            eps.push(ep);
          }
          if (!eps.length) { reject(new Error('Không sinh được encodeparam')); return; }
          resolve(eps);
        })
        .catch(e => reject(new Error('getcredential: ' + e.message)));
    } catch (e) {
      reject(new Error(e.message));
    }
  });
}

async function uploadImgToServer(blob) {
  const fd = new FormData();
  fd.append('file', blob, blob.name || 'image.jpg');
  const resp = await fetch('/api/msdk/upload', { method: 'POST', body: fd });
  const d = await resp.json();
  if (!d.ok) throw new Error(d.error || 'Upload failed');
  return d.filename;
}

async function startMsdkJob(authToken, mediaFilename, encodeparams) {
  const resp = await fetch('/api/msdk/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      media_filename: mediaFilename,
      encodeparams: encodeparams || [],
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
          log(e.level, e.msg);
        }
        window._msdkLogOffset = (window._msdkLogOffset || 0) + d.logs.length;
      }
      if (d.progress !== undefined) {
        setProgress(d.progress, d.progLabel || '');
      }
      if (d.done) {
        document.getElementById('okCount').textContent = d.done.ok || 0;
        document.getElementById('failCount').textContent = d.done.fail || 0;
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

// ── Main ──────────────────────────────────────────────────────────────────
async function run() {
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  setProgress(0, 'Đang chuẩn bị...');
  logGold('══════════════════════════════');
  logGold('   Đổi Poster — Bắt đầu');
  logGold('══════════════════════════════');

  parseTokenInput();
  if (!state.tokenData) {
    logErr('Chưa dán token');
    btn.disabled = false;
    return;
  }
  if (!state.imgOrigBlob) {
    logErr('Chưa chọn ảnh');
    btn.disabled = false;
    return;
  }

  try {
    // Server-side flow for hex-only MSDK token
    if (state.tokenData._msdkOnly) {
      const rawHex = state.tokenData._msdkToken;
      let eps = [];
      try {
        eps = await initClientSignBridge(rawHex);
        logOk(`Sign bridge OK — ${eps.length} encodeparam sẵn sàng`);
      } catch (sbErr) {
        logWarn('Sign bridge: ' + sbErr.message);
      }

      logInf('Upload ảnh lên server...');
      setProgress(5, 'Upload ảnh...');
      const fname = await uploadImgToServer(state.imgOrigBlob);
      logOk(`Upload OK: ${fname}`);

      logInf('Khởi tạo job...');
      setProgress(10, 'Khởi tạo...');
      const jobId = await startMsdkJob(rawHex, fname, eps);
      logOk(`Job ID: ${jobId}`);
      _msdkJobId = jobId;
      window._msdkLogOffset = 0;
      pollMsdkStatus();
    } else {
      // Client-side flow with access_token
      logInf('Tính năng client-side đang phát triển — dùng server-side với hex token');
      throw new Error('Vui lòng dùng mã hex (Msdk-Itopencodeparam) thay vì access_token');
    }
  } catch (err) {
    logErr('❌ Lỗi: ' + err.message);
    state.stats.fail++;
    updateStats();
    btn.disabled = false;
  }
}

// ── Theme toggle ──────────────────────────────────────────────────────────
function toggleTheme() {
  const body = document.body;
  body.classList.toggle('light');
  const btn = document.querySelector('.theme-toggle');
  btn.textContent = body.classList.contains('light') ? '☀️' : '🌙';
  localStorage.setItem('theme', body.classList.contains('light') ? 'light' : 'dark');
}

(function() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light');
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = '☀️';
  }
})();

// ── Event bindings ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('runBtn').addEventListener('click', run);
  document.getElementById('clearLogs').addEventListener('click', clearLog);

  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', e => handleImgFile(e.target.files[0]));

  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', handleImgDrop);

  document.getElementById('previewUrlBtn').addEventListener('click', () => {
    loadImgFromUrl(document.getElementById('posterUrl').value.trim());
  });
  document.getElementById('posterUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadImgFromUrl(e.target.value.trim());
  });

  document.getElementById('tokenInput').addEventListener('input', parseTokenInput);

  logInf('Sẵn sàng — dán mã hex (Msdk-Itopencodeparam) để bắt đầu');
});
