/* ==========================================================================
 * state.js —— 全局状态、持久化、通用小工具、浮层 / Toast / 专注计时器
 * ========================================================================== */
'use strict';

const C = window.PlannerCore;
const STORE_KEY = 'ddl-planner-v1';

const S = {
  tasks: [],
  events: [],
  settings: Object.assign({}, C.DEFAULT_SETTINGS),
  view: 'today',        // today | calendar | tasks | settings
  selDate: C.todayISO(),
  calY: new Date().getFullYear(),
  calM: new Date().getMonth(),
  filter: 'all',
  query: '',
  focus: null,
  fired: {},
  seeded: false,
  localUpdatedAt: 0
};

/* ---------------- 工具 ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function icon(name, cls) {
  return `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {}
}

/* ---------------- 持久化 ---------------- */
S.storageOk = true;      // 存储是否可用（隐私模式 / 配额满 / 被禁用时为 false）
S.storageError = '';
S.dataOrigin = '';       // 当前存储来源，用于识别「换了打开方式」

const AUTO_BACKUP_KEY = 'ddl-planner-autobackup';
const ORIGIN_KEY = 'ddl-planner-origin';

function currentOriginTag() {
  try {
    // file:// 下 origin 是 "null" 或 "file://"，单独标记
    if (location.protocol === 'file:') return 'file://' + location.pathname;
    return location.origin;
  } catch (e) {
    return 'unknown';
  }
}

function save() {
  try {
    // 1. 写入「当前档案」的独立存储键
    if (typeof persistCurrent === 'function' && typeof activeProfileId !== 'undefined' && activeProfileId) {
      persistCurrent();
    } else {
      // 兜底：档案模块未就绪时仍写全局键
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tasks: S.tasks, events: S.events, settings: S.settings,
        seeded: S.seeded, fired: S.fired, v: 2
      }));
    }

    // 2. 同步一份自动备份（用于换入口/误删时找回）
    if (S.tasks.length > 0 || S.events.length > 0) {
      try {
        localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({
          tasks: S.tasks,
          events: S.events,
          settings: S.settings,
          savedAt: new Date().toISOString(),
          origin: currentOriginTag(),
          profile: (typeof currentProfile === 'function' && currentProfile()) ? currentProfile().name : '',
          v: 2
        }));
      } catch (e) { /* 备份失败不影响主流程 */ }
    }
    try { localStorage.setItem(ORIGIN_KEY, currentOriginTag()); } catch (e) {}

    if (!S.storageOk) {           // 之前失败过，现在恢复了
      S.storageOk = true;
      S.storageError = '';
      renderStorageBanner();
    }
    return true;
  } catch (e) {
    S.storageOk = false;
    S.storageError = (e && e.name) || 'Error';
    console.warn('保存失败', e);
    renderStorageBanner();
    return false;
  }
}

/**
 * 读取自动备份。用于两种情况：
 *  1. 换了打开方式 / 换了文件位置，主存储读不到
 *  2. 用户手动「找回上次的数据」
 */
function readAutoBackup() {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d.tasks) || d.tasks.length === 0) return null;
    return d;
  } catch (e) {
    return null;
  }
}

/* 存储异常时在页面顶部挂一条醒目的提示，避免"以为存上了其实没有" */
function renderStorageBanner() {
  let el = document.querySelector('.storage-warning');
  if (S.storageOk) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'storage-warning';
    el.innerHTML = `
      <b>⚠️ 记录无法保存到本机</b>
      <span>可能是无痕模式、或浏览器禁用了存储。请换成普通窗口打开，
      并到「设置 → 备份数据」先导出备份，避免任务丢失。</span>
      <button data-act="export-json">立即备份</button>`;
    const app = document.querySelector('.app');
    if (app) app.insertBefore(el, app.firstChild);
    else document.body.appendChild(el);
  }
}

function load() {
  S.dataOrigin = currentOriginTag();

  // 1. 初始化档案系统（会建默认档案）
  let profileReady = false;
  try {
    if (typeof loadProfiles === 'function') {
      loadProfiles();
      profileReady = true;
    }
    S.storageOk = true;
  } catch (e) {
    S.storageOk = false;
    S.storageError = (e && e.name) || 'Error';
    console.warn('档案初始化失败', e);
    return false;
  }

  // 2. 把旧版全局数据搬进默认档案（只搬一次）
  if (profileReady && typeof migrateLegacyData === 'function') {
    try { migrateLegacyData(); } catch (e) {}
  }

  // 3. 读当前档案的数据
  let raw = null;
  try {
    raw = profileReady
      ? localStorage.getItem(typeof dataKey === 'function' ? dataKey(activeProfileId) : STORE_KEY)
      : localStorage.getItem(STORE_KEY);
  } catch (e) {
    console.warn('读取失败', e);
  }

  if (!raw) {
    // 主存储没有数据，但可能存在「自动备份」——说明之前用过，只是换了打开方式
    const bk = readAutoBackup();
    if (bk) {
      S.tasks = (bk.tasks || []).map(C.normalizeTask);
      S.events = bk.events || [];
      S.settings = Object.assign({}, C.DEFAULT_SETTINGS, bk.settings || {});
      S.seeded = true;
      S.fired = {};
      S.recovered = true;              // 标记：本次是从备份自动恢复的
      S.recoveredFrom = bk.origin || '上次的打开方式';
      S.recoveredAt = bk.savedAt || '';
      // 立刻写回，让当前档案也拥有数据
      setTimeout(() => save(), 0);
      return true;
    }
    return false;
  }

  try {
    const d = JSON.parse(raw);
    S.tasks = (d.tasks || []).map(C.normalizeTask);
    S.events = d.events || [];
    S.settings = Object.assign({}, C.DEFAULT_SETTINGS, d.settings || {});
    S.seeded = !!d.seeded;
    S.fired = d.fired || {};
    return true;
  } catch (e) {
    console.warn('读取失败', e);
    return false;
  }
}

function taskById(id) { return S.tasks.find(t => t.id === id) || null; }

/* ---------------- Toast ---------------- */
function toast(msg, ms) {
  const root = $('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, ms || 1800);
}

/* ---------------- 底部弹窗 ---------------- */
let sheetCtx = null;
let currentDetailId = null;

function closeSheet(instant) {
  const root = $('#overlay-root');
  if (sheetCtx && sheetCtx.dragCleanup) { try { sheetCtx.dragCleanup(); } catch (e) {} }
  if (!root || !root.firstChild) { sheetCtx = null; return; }
  const sheets = $$('.sheet', root), scrims = $$('.scrim', root);
  sheets.forEach(s => s.classList.remove('show'));
  scrims.forEach(s => s.classList.remove('show'));
  const done = () => { root.innerHTML = ''; };
  if (instant) done(); else setTimeout(done, 260);
  if (sheetCtx && sheetCtx.onClose) { try { sheetCtx.onClose(); } catch (e) {} }
  sheetCtx = null;
}

function openSheet(opts) {
  const root = $('#overlay-root');
  closeSheet(true);
  root.innerHTML = '';

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.addEventListener('click', () => closeSheet());

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet-grab"><i></i></div>
    <div class="sheet-head">
      <h2>${esc(opts.title || '')}</h2>
      ${opts.headExtra || ''}
      <button class="sheet-close" data-act="sheet-close" aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="sheet-body">${opts.body || ''}</div>
    ${opts.foot ? `<div class="sheet-foot">${opts.foot}</div>` : ''}
  `;
  root.appendChild(scrim);
  root.appendChild(sheet);

  // 下滑关闭
  const grab = $('.sheet-grab', sheet);
  let sy = null, dy = 0;
  const onStart = e => {
    sy = e.touches ? e.touches[0].clientY : e.clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const onMove = e => {
    if (sy === null) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dy = Math.max(0, y - sy);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (sy === null) return;
    sy = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 70) closeSheet();
  };
  grab.addEventListener('touchstart', onStart, { passive: true });
  grab.addEventListener('touchmove', onMove, { passive: true });
  grab.addEventListener('touchend', onEnd);
  grab.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  opts.dragCleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
  };

  sheetCtx = opts;
  requestAnimationFrame(() => {
    scrim.classList.add('show');
    sheet.classList.add('show');
  });
  if (opts.onMount) setTimeout(() => { try { opts.onMount(sheet); } catch (e) { console.error(e); } }, 30);
  return sheet;
}

function updateSheetBody(html, remount) {
  const body = $('.sheet-body');
  if (!body) return;
  body.innerHTML = html;
  if (remount && sheetCtx && sheetCtx.onMount) {
    try { sheetCtx.onMount($('.sheet')); } catch (e) { console.error(e); }
  }
}

/* ---------------- 专注计时器 ---------------- */
const focusTimer = { id: null };

function startFocus(opts) {
  const minutes = Math.max(1, Math.round(opts.minutes || 25));
  S.focus = {
    taskId: opts.taskId,
    subId: opts.subId || null,
    title: opts.title || '专注',
    sub: opts.sub || '',
    total: minutes,
    remain: minutes * 60,
    running: true,
    startedAt: Date.now()
  };
  renderFocusOverlay();
  clearInterval(focusTimer.id);
  focusTimer.id = setInterval(tickFocus, 1000);
}

function tickFocus() {
  const f = S.focus;
  if (!f) { clearInterval(focusTimer.id); return; }
  if (!f.running) return;
  f.remain -= 1;
  if (f.remain <= 0) {
    f.remain = 0;
    f.running = false;
    finishFocus(true);
    return;
  }
  paintFocus();
}

function paintFocus() {
  const f = S.focus;
  if (!f) return;
  const total = f.total * 60;
  const el = $('.focus-ring .bar');
  const R = 46, CIRC = 2 * Math.PI * R;
  if (el) {
    const p = Math.max(0, Math.min(1, f.remain / total));
    el.style.strokeDasharray = CIRC;
    el.style.strokeDashoffset = CIRC * (1 - p);
  }
  const t = $('.focus-time');
  if (t) {
    const m = Math.floor(f.remain / 60), s = f.remain % 60;
    t.textContent = `${C.pad2(m)}:${C.pad2(s)}`;
  }
}

function renderFocusOverlay() {
  const f = S.focus;
  const root = $('#overlay-root');
  const old = $('.focus-wrap');
  if (!f) {
    if (old) old.remove();
    clearInterval(focusTimer.id);
    return;
  }
  const R = 46, CIRC = 2 * Math.PI * R;
  const wrap = document.createElement('div');
  wrap.className = 'focus-wrap';
  wrap.innerHTML = `
    <div class="f-task">${esc(f.title)}</div>
    ${f.sub ? `<div class="f-sub">${esc(f.sub)}</div>` : '<div class="f-sub">专注中，保持一次只做一件事</div>'}
    <div class="focus-ring">
      <svg viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="${R}" fill="none" stroke-width="3"></circle>
        <circle class="bar" cx="50" cy="50" r="${R}" fill="none" stroke-width="3"
          stroke-dasharray="${CIRC}" stroke-dashoffset="0"></circle>
      </svg>
      <div class="focus-time">${C.pad2(Math.floor(f.remain / 60))}:${C.pad2(f.remain % 60)}</div>
    </div>
    <div class="focus-actions">
      <button class="btn" data-act="focus-toggle">${f.running ? icon('pause') + '暂停' : icon('play') + '继续'}</button>
      <button class="btn primary" data-act="focus-done">结束专注</button>
    </div>
    <button class="btn" style="background:transparent;color:rgba(255,255,255,.5);font-size:12.5px;padding:6px 10px" data-act="focus-close">放弃本次</button>
  `;
  if (old) old.replaceWith(wrap); else (root || document.body).appendChild(wrap);
  paintFocus();
}

function finishFocus(completed) {
  const f = S.focus;
  if (!f) return;
  clearInterval(focusTimer.id);
  const spent = Math.round((f.total * 60 - f.remain) / 60);
  if (spent > 0) {
    const t = taskById(f.taskId);
    if (t) { t.spent = (t.spent || 0) + spent; }
  }
  const el = $('.focus-wrap');
  if (el) el.remove();
  S.focus = null;
  save();
  vibrate([40, 60, 40]);
  if (completed) {
    toast('专注完成 · 已记录 ' + C.fmtDuration(spent));
    if (window.Notification && Notification.permission === 'granted') {
      try { new Notification('专注完成 🎉', { body: f.title }); } catch (e) {}
    }
  } else {
    toast('已记录 ' + C.fmtDuration(spent));
  }
  render();
}

/* ---------------- 提醒 ---------------- */
function checkReminders() {
  if (!S.settings.reminders) return;
  const today = C.todayISO();
  const nowMin = C.currentMin();
  const before = S.settings.remindBefore || 10;

  S.tasks.forEach(t => {
    if (t.done || !t.due) return;
    const key = 'task:' + t.id + ':' + today + ':' + (t.dueTime || 'allday');
    if (S.fired[key]) return;

    if (!t.dueTime) {
      // 只有日期时：当天第一次检查提醒一次
      if (t.due === today && nowMin >= 8 * 60) {
        S.fired[key] = 1;
        notify('今天截止：' + t.title, '还剩 ' + C.fmtDuration(C.remainingMinutes(t)) + ' 的工作');
      }
      return;
    }

    if (t.due !== today) return;
    const due = C.minutesOf(t.dueTime);
    const diff = due - nowMin;
    if (diff >= 0 && diff <= before) {
      S.fired[key] = 1;
      notify(`${diff} 分钟后截止：${t.title}`, '现在开始还来得及');
    } else if (diff < 0 && diff > -60) {
      S.fired[key] = 1;
      notify(`已到截止时间：${t.title}`, '需要顺延吗？可以到详情里改个日期');
    }
  });

  // 每天 21:00 之后预告明天的任务
  if (nowMin >= 21 * 60) {
    const tomorrow = C.addDaysISO(today, 1);
    const tmr = S.tasks.filter(t => !t.done && t.due === tomorrow);
    const key = 'tomorrow:' + today;
    if (tmr.length && !S.fired[key]) {
      S.fired[key] = 1;
      notify(`明天有 ${tmr.length} 个任务到期`, tmr.slice(0, 3).map(t => t.title).join('、'));
    }
  }

  // 清理过期记录，避免 localStorage 无限增长
  const keys = Object.keys(S.fired);
  if (keys.length > 60) {
    keys.filter(k => !k.includes(today)).forEach(k => { delete S.fired[k]; });
  }
}

function notify(title, body) {
  vibrate([30, 40, 30]);
  toast(title);
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification(title, { body: body || '', tag: title }); } catch (e) {}
  }
}

/* ---------------- 下载 ---------------- */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
}
