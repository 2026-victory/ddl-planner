/* ==========================================================================
 * sync.js —— 账号登录与云端同步
 *   设计原则：
 *   - 未登录时和以前完全一样（纯本地），不影响离线使用
 *   - 登录后：本地改动自动推送到云端（防抖 1.2s），启动时自动拉取
 *   - 冲突策略：以「最后修改的一方」为准，并明确提示用户
 * ========================================================================== */
'use strict';

const AUTH_KEY = 'ddl-planner-auth';
const SYNC_DEBOUNCE = 1200;

/** 构建时预置的后端地址（见 config.js） */
function presetBackendUrl() {
  try {
    return (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) || '';
  } catch (e) {
    return '';
  }
}

/** 是否运行在「打包成 App」的环境里（Capacitor / Cordova） */
function isNativeShell() {
  try {
    return !!window.Capacitor || location.protocol === 'capacitor:' ||
      location.protocol === 'file:' || /^https?:\/\/localhost$/.test(location.origin);
  } catch (e) {
    return false;
  }
}

const Cloud = {
  serverAvailable: null,   // null=未探测 true/false
  token: '',
  username: '',
  hasPassword: false,
  lastSyncAt: 0,
  lastError: '',
  syncing: false,
  timer: null,
  remoteRev: 0,
  baseUrl: presetBackendUrl()   // 优先用打包时预置的地址
};

/* ---------------- 配置保存 ---------------- */
function saveAuth() {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      token: Cloud.token,
      username: Cloud.username,
      hasPassword: Cloud.hasPassword,
      baseUrl: Cloud.baseUrl,
      lastSyncAt: Cloud.lastSyncAt
    }));
  } catch (e) {}
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Cloud.token = d.token || '';
    Cloud.username = d.username || '';
    Cloud.hasPassword = !!d.hasPassword;
    // 用户手填的地址优先；没填过就用打包预置的
    Cloud.baseUrl = d.baseUrl || presetBackendUrl();
    Cloud.lastSyncAt = d.lastSyncAt || 0;
  } catch (e) {}
}

function clearAuth() {
  Cloud.token = '';
  Cloud.username = '';
  Cloud.hasPassword = false;
  Cloud.lastSyncAt = 0;
  Cloud.remoteRev = 0;
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
}

function isLoggedIn() {
  return !!Cloud.token && !!Cloud.username;
}

/* ---------------- 请求 ---------------- */
function apiUrl(p) {
  const base = Cloud.baseUrl || '';
  return (base ? base.replace(/\/$/, '') : '') + p;
}

async function apiFetch(method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (Cloud.token) headers['Authorization'] = 'Bearer ' + Cloud.token;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(apiUrl(p), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.name === 'AbortError' ? '请求超时' : '网络不可用' } };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 探测服务器 ---------------- */
async function probeServer() {
  // App（capacitor:// / file://）或手动填了地址时，必须显式访问远端后端
  const needsRemote = Cloud.baseUrl || isNativeShell();

  if (needsRemote && !Cloud.baseUrl) {
    // App 里没配后端地址 → 明确告知，而不是盲目发请求
    Cloud.serverAvailable = false;
    Cloud.lastError = 'App 未配置服务器地址';
    return false;
  }

  const r = await apiFetch('GET', '/api/health');
  Cloud.serverAvailable = r.ok && r.data && r.data.ok === true;
  return Cloud.serverAvailable;
}

/* ---------------- 版本信息 ---------------- */
/** 当前应用版本（由 build.js 注入） */
function appVersion() {
  try {
    return (window.APP_CONFIG && window.APP_CONFIG.VERSION) || 'dev';
  } catch (e) {
    return 'dev';
  }
}

/** 当前构建时间（由 build.js 注入） */
function appBuildTime() {
  try {
    return (window.APP_CONFIG && window.APP_CONFIG.BUILD_TIME) || '';
  } catch (e) {
    return '';
  }
}

/* ---------------- 注册 / 登录 ---------------- */
/** 把网络层错误翻译成用户能看懂、能行动的提示 */
function explainNetError(r, fallback) {
  if (r.status === 404) {
    return '这个网址没有后端服务，所以账号功能用不了。点下方「查看原因」了解怎么解决。';
  }
  if (r.status === 0) {
    return '连不上服务器（' + (r.data.error || '网络不可用') + '）。请检查网络，或确认服务器地址填对了。';
  }
  return r.data.error || fallback;
}

async function cloudRegister(username, password) {
  const r = await apiFetch('POST', '/api/register', { username, password: password || '' });
  if (!r.ok) return { ok: false, error: explainNetError(r, '注册失败') };
  Cloud.token = r.data.token;
  Cloud.username = r.data.username;
  Cloud.hasPassword = !!password;
  saveAuth();
  return { ok: true, isNew: true };
}

async function cloudLogin(username, password) {
  const r = await apiFetch('POST', '/api/login', { username, password: password || '' });
  if (!r.ok) return { ok: false, error: explainNetError(r, '登录失败') };
  Cloud.token = r.data.token;
  Cloud.username = r.data.username;
  Cloud.hasPassword = !!r.data.hasPassword;
  saveAuth();
  return { ok: true };
}

async function cloudLogout() {
  try { await apiFetch('POST', '/api/logout', {}); } catch (e) {}
  clearAuth();
}

/* ---------------- 推送 / 拉取 ---------------- */
async function pushToCloud(silent) {
  if (!isLoggedIn()) return { ok: false, error: '未登录' };
  if (Cloud.syncing) return { ok: false, error: '同步中' };
  Cloud.syncing = true;
  renderSyncStatus();

  const r = await apiFetch('PUT', '/api/data', {
    tasks: S.tasks,
    events: S.events,
    settings: S.settings
  });

  Cloud.syncing = false;
  if (r.ok) {
    Cloud.lastSyncAt = Date.now();
    Cloud.lastError = '';
    Cloud.remoteRev = r.data.rev || Cloud.remoteRev + 1;
    saveAuth();
    if (!silent) toast('已同步到云端');
    renderSyncStatus();
    return { ok: true };
  }

  Cloud.lastError = r.data.error || '同步失败';
  if (r.status === 401) {
    // token 失效：退回本地模式，避免用户继续以为是同步状态
    clearAuth();
    toast('登录已过期，已切回本地模式，请重新登录');
    render();
    return { ok: false, error: Cloud.lastError };
  }
  renderSyncStatus();
  if (!silent) toast(Cloud.lastError);
  return { ok: false, error: Cloud.lastError };
}

async function pullFromCloud(opts) {
  opts = opts || {};
  if (!isLoggedIn()) return { ok: false, error: '未登录' };

  const r = await apiFetch('GET', '/api/data');
  if (!r.ok) {
    Cloud.lastError = r.data.error || '拉取失败';
    if (r.status === 401) {
      clearAuth();
      toast('登录已过期，已切回本地模式');
      render();
    }
    return { ok: false, error: Cloud.lastError };
  }

  const remote = r.data;
  const remoteTasks = remote.tasks || [];
  Cloud.remoteRev = remote.rev || 0;

  // 云端为空：把本地推上去
  if (remoteTasks.length === 0 && S.tasks.length > 0) {
    const pushed = await pushToCloud(true);
    return { ok: pushed.ok, mode: 'pushed-local' };
  }

  // 本地为空：直接接受云端
  if (S.tasks.length === 0 && remoteTasks.length > 0) {
    applyRemote(remote);
    Cloud.lastSyncAt = Date.now();
    saveAuth();
    return { ok: true, mode: 'pulled-remote', count: remoteTasks.length };
  }

  // 双方都有数据：比对时间戳
  const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
  const localTime = S.localUpdatedAt || 0;

  if (remoteTime > localTime + 2000) {
    applyRemote(remote);
    Cloud.lastSyncAt = Date.now();
    saveAuth();
    return { ok: true, mode: 'pulled-remote', count: remoteTasks.length };
  }

  if (localTime > remoteTime + 2000) {
    const pushed = await pushToCloud(true);
    return { ok: pushed.ok, mode: 'pushed-local' };
  }

  // 差不多：若初始化时勾了「以云端为准」则覆盖
  if (opts.preferRemote) {
    applyRemote(remote);
    return { ok: true, mode: 'pulled-remote', count: remoteTasks.length };
  }

  return { ok: true, mode: 'in-sync', count: remoteTasks.length };
}

function applyRemote(remote) {
  S.tasks = (remote.tasks || []).map(C.normalizeTask);
  S.events = remote.events || [];
  if (remote.settings) S.settings = Object.assign({}, C.DEFAULT_SETTINGS, remote.settings);
  S.seeded = true;
}

/* ---------------- 自动同步 ---------------- */
function scheduleSync() {
  if (!isLoggedIn()) return;
  const now = Date.now();
  S.localUpdatedAt = now;
  clearTimeout(Cloud.timer);
  Cloud.timer = setTimeout(() => { pushToCloud(true); }, SYNC_DEBOUNCE);
}

/* ---------------- 状态渲染 ---------------- */
function renderSyncStatus() {
  const el = document.querySelector('[data-sync-status]');
  if (!el) return;

  // 纯本地模式：显示档案名 + 数据只在本机
  const p = (typeof currentProfile === 'function') ? currentProfile() : null;
  const name = p ? p.name : '我';
  const total = S.tasks.length;
  el.innerHTML =
    `<span class="sync-dot ok"></span>数据在本机` +
    (total > 0 ? ` · ${total} 个任务` : '');
}

/* ---------------- 登录界面 ---------------- */
function openAccountSheet() {
  const logged = isLoggedIn();
  const canReachServer = Cloud.serverAvailable !== false;

  openSheet({
    title: logged ? '账号' : '登录 / 注册',
    body: logged ? `
      <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 24%,transparent)">
        ${icon('check')}
        <div>当前已登录 <b>${esc(Cloud.username)}</b>，数据会自动同步到云端，换设备登录同一账号即可取回。</div>
      </div>
      <div class="card" style="padding:14px;background:var(--paper);box-shadow:none;border:1px solid var(--line-soft);margin-top:12px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0">
          <span class="muted">云端任务</span><b data-cloud-count>—</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0">
          <span class="muted">最近同步</span><b data-last-sync>—</b>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn grow" data-act="cloud-pull">从云端刷新</button>
        <button class="btn grow" data-act="cloud-push">立即上传</button>
      </div>
      <button class="btn danger" style="width:100%;margin-top:8px" data-act="cloud-logout">退出登录</button>
      <div class="notice" style="margin-top:12px">
        ${icon('flag')}
        <div>退出后回到本地模式，本机数据保留不变。</div>
      </div>
    ` : `
      ${canReachServer ? '' : `
      <div class="notice danger" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;gap:9px;align-items:flex-start">
          ${icon('flag')}
          <div><b>这个网址只有网页，没有后端服务。</b><br>
          所以账号登录用不了 —— 任务仍然会正常保存在本机，只是没法跨设备同步。</div>
        </div>
        <button class="btn sm" style="align-self:flex-start;background:var(--card)"
          data-act="why-no-server">查看原因和解决办法</button>
      </div>`}
      <div class="field">
        <label>账号名 <span class="hint">2~24 位，中英文均可</span></label>
        <input class="input big" id="acc-name" placeholder="例如：xiaoming" autocomplete="username">
      </div>
      <div class="field">
        <label>密码 <span class="hint">可选，留空即免密登录</span></label>
        <input class="input" id="acc-pass" type="password" placeholder="不填就只用账号名" autocomplete="current-password">
      </div>
      <div class="notice" style="background:var(--sky-soft);border-color:color-mix(in srgb,var(--sky) 22%,transparent)">
        ${icon('spark')}
        <div>登录后，你的任务会保存到云端，<b>换手机登录同一账号就能拿回全部安排</b>。</div>
      </div>
      <div class="field" style="margin-top:14px">
        <label>服务器地址 <span class="hint">同源部署可留空</span></label>
        <input class="input" id="srv-url" placeholder="https://your-app.onrender.com" value="${esc(Cloud.baseUrl || '')}">
      </div>
    `,
    foot: logged
      ? `<button class="btn primary" data-act="sheet-close">关闭</button>`
      : `<button class="btn ghost" data-act="acc-register">注册</button>
         <button class="btn primary" data-act="acc-login">登录</button>`,
    onMount(sheet) {
      if (!logged) {
        setTimeout(() => { const el = $('#acc-name', sheet); if (el) el.focus(); }, 340);
      }
      if (logged) {
        refreshAccountInfo();
      }
    }
  });
}

async function refreshAccountInfo() {
  const r = await apiFetch('GET', '/api/data');
  const cntEl = document.querySelector('[data-cloud-count]');
  if (cntEl) cntEl.textContent = r.ok ? (r.data.tasks || []).length + ' 个' : '读取失败';
  const syncEl = document.querySelector('[data-last-sync]');
  if (syncEl) {
    const t = Cloud.lastSyncAt ? new Date(Cloud.lastSyncAt) : null;
    syncEl.textContent = t
      ? `${t.getMonth() + 1}/${t.getDate()} ${C.pad2(t.getHours())}:${C.pad2(t.getMinutes())}`
      : '尚未同步';
  }
}

/* ---------------- 登录后的初始化 ---------------- */
async function afterLogin() {
  const pulled = await pullFromCloud({ preferRemote: false });
  closeSheet(true);
  render();
  renderSyncStatus();
  if (pulled.ok) {
    if (pulled.mode === 'pulled-remote') {
      toast(`已取回云端 ${pulled.count} 个任务`);
      S.view = 'today';
      render();
    } else if (pulled.mode === 'pushed-local') {
      toast('本地数据已上传到云端');
    } else {
      toast('已登录，数据已同步');
    }
  } else {
    toast('已登录，但同步失败：' + (pulled.error || '未知错误'));
  }
}

/* ---------------- 记住登录：下次打开直接可用 ---------------- */
/**
 * 若本地存有有效 token，启动时静默恢复会话并拉取最新数据。
 * 用户不需要再登录一次 —— 这就是「一登录就能用」。
 */
async function restoreSession() {
  if (!isLoggedIn()) return { ok: false, reason: 'not-logged-in' };

  const available = await probeServer();
  if (!available) {
    // 没网也不阻塞：先用本地数据，联网后再同步
    return { ok: false, reason: 'offline' };
  }

  // 先验证 token 是否仍有效
  const me = await apiFetch('GET', '/api/me');
  if (me.status === 401) {
    clearAuth();
    return { ok: false, reason: 'expired' };
  }
  if (!me.ok) {
    return { ok: false, reason: 'unreachable' };
  }

  // token 有效，再拉数据
  const pulled = await pullFromCloud({ preferRemote: false });

  // 拉取过程中若 token 失效（服务端会话可能刚好过期），同样按过期处理
  if (!pulled.ok) {
    const stillLogged = isLoggedIn();
    if (!stillLogged) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'sync-failed', error: pulled.error };
  }

  if (pulled.mode === 'pulled-remote') {
    return { ok: true, mode: 'pulled-remote', count: pulled.count };
  }
  return { ok: true, mode: pulled.mode || 'in-sync' };
}
