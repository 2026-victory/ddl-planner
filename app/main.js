/* ==========================================================================
 * main.js —— 事件委托、启动流程
 * ========================================================================== */
'use strict';

/* ---------------- 动作表 ---------------- */
const ACTIONS = {
  tab(el) {
    S.view = el.dataset.tab;
    closeSheet(true);
    render();
  },
  add(el) {
    openTaskEditor(null, el.dataset.date);
  },
  'goto-today'() {
    S.selDate = C.todayISO();
    S.calY = new Date().getFullYear();
    S.calM = new Date().getMonth();
    render();
  },
  'goto-settings'() {
    closeSheet();
    S.view = 'settings';
    render();
  },
  'pick-day'(el) {
    const iso = el.dataset.date;
    S.selDate = iso;
    if (S.view === 'today') {
      S.view = 'calendar';
    }
    const d = C.parseISO(iso);
    S.calY = d.getFullYear();
    S.calM = d.getMonth();
    render();
  },
  filter(el) {
    S.filter = el.dataset.key;
    render();
  },
  'cal-prev'() {
    S.calM -= 1;
    if (S.calM < 0) { S.calM = 11; S.calY -= 1; }
    render();
  },
  'cal-next'() {
    S.calM += 1;
    if (S.calM > 11) { S.calM = 0; S.calY += 1; }
    render();
  },
  'toggle-task'(el, ev) {
    ev.stopPropagation();
    const t = taskById(el.dataset.id);
    if (!t) return;
    toggleTaskDone(t);
    save();          // ← 勾选完成/撤销必须立刻落盘，否则关掉页面就丢
    render();
  },
  'open-task'(el) {
    openTaskDetail(el.dataset.id);
  },
  'focus-block'(el, ev) {
    ev.stopPropagation();
    const t = taskById(el.dataset.id);
    if (!t) return;
    startFocus({
      taskId: t.id,
      subId: el.dataset.sub || null,
      title: el.dataset.title || t.title,
      sub: t.title !== el.dataset.title ? t.title : '',
      minutes: Math.min(45, Math.max(10, Math.round(+el.dataset.min || 25)))
    });
  },
  replan() {
    render();
    toast('已按最新优先级重新排程');
  },
  'plan-week'() {
    closeSheet(true);
    openPlanWeek();
  },
  'add-event'(el) {
    openEventEditor(el.dataset.date);
  },
  'del-event'(el, ev) {
    ev.stopPropagation();
    S.events = S.events.filter(e => e.id !== el.dataset.id);
    save();
    toast('已删除');
    render();
  },
  'save-event'() { saveEvent(); },
  'sheet-close'() { closeSheet(); },
  'save-task'(el) { saveTask(el.dataset.id || null, false); },
  'add-with-split'(el) {
    // 先保存，再进入拆解
    const id = saveTaskAndGetId();
    if (id) setTimeout(() => openBreakdown(id, true), 260);
  },
  'detail-split'() {
    const id = currentDetailId;
    closeSheet();
    if (id) setTimeout(() => openBreakdown(id, true), 260);
  },
  'detail-focus'(el) {
    const t = taskById(el.dataset.id);
    if (!t) return;
    const remain = C.remainingMinutes(t);
    closeSheet();
    setTimeout(() => {
      startFocus({
        taskId: t.id,
        title: t.title,
        sub: '还剩 ' + C.fmtDuration(remain),
        minutes: Math.min(45, Math.max(10, Math.round(remain || 25)))
      });
    }, 220);
  },
  'toggle-sub'(el, ev) {
    ev.stopPropagation();
    const t = taskById(el.dataset.id);
    if (!t) return;
    const s = t.subtasks.find(x => x.id === el.dataset.sub);
    if (!s) return;
    s.done = !s.done;
    s.doneAt = s.done ? C.todayISO() : null;
    syncTaskDone(t);
    save();
    vibrate(8);
    render();
    const stillOpen = $('.sheet');
    if (stillOpen) openTaskDetail(t.id, true);
  },
  'del-sub'(el, ev) {
    ev.stopPropagation();
    const t = taskById(el.dataset.id);
    if (!t) return;
    t.subtasks = t.subtasks.filter(x => x.id !== el.dataset.sub);
    t.estimate = t.subtasks.length ? C.totalEstimate(t) : t.estimate;
    save();
    render();
    const stillOpen = $('.sheet');
    if (stillOpen) openTaskDetail(t.id, true);
  },
  'save-detail'(el) { saveDetail(el.dataset.id); },
  'delete-task'(el) {
    const t = taskById(el.dataset.id);
    if (!t) return;
    if (!confirm('删除「' + C.shortTitle(t.title, 14) + '」？此操作不可撤销。')) return;
    S.tasks = S.tasks.filter(x => x.id !== t.id);
    save();
    closeSheet();
    toast('已删除');
    render();
  },
  'split-apply'(el) { /* 由弹窗内部绑定处理 */ },
  'split-cancel'() { closeSheet(); },
  'toggle-remind'(el) {
    S.settings.reminders = !S.settings.reminders;
    save();
    el.classList.toggle('on', S.settings.reminders);
    toast(S.settings.reminders ? '提醒已开启' : '提醒已关闭');
  },
  'ask-notify'() {
    if (!window.Notification) { toast('当前环境不支持系统通知'); return; }
    Notification.requestPermission().then(p => {
      render();
      toast(p === 'granted' ? '已开启通知' : '未获得通知权限');
    });
  },
  'export-ics'() {
    const today = C.todayISO();
    const plans = C.planRange({
      startISO: today, days: 14, tasks: S.tasks,
      events: S.events, settings: S.settings, nowISO: today, nowMin: C.currentMin()
    });
    const blocks = plans.reduce((acc, p) => acc.concat(p.blocks), []);
    const ics = C.buildICS({ tasks: S.tasks, blocks, events: S.events });
    download('DDL计划表-' + today + '.ics', ics, 'text/calendar;charset=utf-8');
    toast('已导出 .ics，可导入手机日历');
  },
  'export-json'() {
    download('ddl-备份-' + C.todayISO() + '.json', JSON.stringify({
      tasks: S.tasks, events: S.events, settings: S.settings, v: 1
    }, null, 2), 'application/json');
    toast('已备份');
  },
  'import-json'() {
    const f = $('#import-file');
    if (f) f.click();
  },
  'restore-autobackup'() {
    const bk = readAutoBackup();
    if (!bk) { toast('没有可用的自动备份'); return; }
    const when = bk.savedAt ? new Date(bk.savedAt) : null;
    const whenText = when ? `${when.getMonth() + 1}月${when.getDate()}日` : '上次';
    if (!confirm(`从 ${whenText} 的自动备份恢复？当前的 ${S.tasks.length} 个任务会被覆盖。`)) return;
    S.tasks = (bk.tasks || []).map(C.normalizeTask);
    S.events = bk.events || [];
    if (bk.settings) S.settings = Object.assign({}, C.DEFAULT_SETTINGS, bk.settings);
    S.seeded = true;
    save();
    closeSheet();
    render();
    toast(`已恢复 ${S.tasks.length} 个任务`);
  },
  'install-app'() {
    if (isFileProtocol()) {
      openInstallGuide();
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(choice => {
        if (choice.outcome === 'accepted') toast('正在添加…');
        deferredInstallPrompt = null;
        updateInstallEntry();
      });
      return;
    }
    openInstallGuide();
  },
  'reset-all'() {
    if (!confirm('清空所有任务和安排？建议先做一次备份。')) return;
    S.tasks = []; S.events = []; S.seeded = true; S.fired = {};
    save();
    closeSheet();
    toast('已清空');
    render();
  },
  'focus-toggle'() {
    if (!S.focus) return;
    S.focus.running = !S.focus.running;
    renderFocusOverlay();
  },

  /* ---------------- 本机档案 ---------------- */
  'open-account'() {
    openProfileSheet();
  },
  'switch-profile'(el) {
    doSwitchProfile(el.dataset.id);
  },
  'profile-menu'(el) {
    openProfileMenu(el.dataset.id);
  },
  'new-profile'() {
    doNewProfile();
  },
  'delete-profile'(el) {
    doDeleteProfile(el.dataset.id);
  },
  'export-profile'(el) {
    doExportProfile(el.dataset.id);
  },
  'save-profile-name'(el) {
    const id = el.dataset.id;
    const name = ($('#pf-name').value || '').trim();
    if (!name) { toast('名字不能为空'); return; }
    if (renameProfile(id, name)) {
      if (id === activeProfileId) save();
      render();
      openProfileMenu(id);
      toast('已重命名');
    } else {
      toast('重命名失败');
    }
  },
  'why-no-server'() {
    openWhyNoServer();
  },
  'apply-update'() {
    closeSheet(true);
    toast('正在更新…');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting');
        setTimeout(() => location.reload(), 400);
      }).catch(() => location.reload());
    } else {
      location.reload();
    }
  },
  'check-update'() {
    if (!('serviceWorker' in navigator)) {
      toast('当前环境不支持自动更新，请手动刷新');
      return;
    }
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) { toast('未启用离线缓存，刷新页面即可获取新版本'); return; }
      return reg.update().then(() => {
        if (reg.waiting) { notifyUpdateReady(); }
        else toast('已是最新版本（' + appVersion() + '）');
      });
    }).catch(() => toast('检查失败，请稍后重试'));
  },
  'focus-done'() {
    finishFocus(false);
    closeSheet(true);
  },
  'focus-close'() {
    const f = S.focus;
    if (f) { f.remaining = 0; }
    S.focus = null;
    clearInterval(focusTimer.id);
    const el = $('.focus-wrap');
    if (el) el.remove();
    toast('已放弃本次专注');
  }
};

function saveTaskAndGetId() {
  const data = readEditor();
  const task = C.normalizeTask(Object.assign({ due: C.todayISO() }, data));
  S.tasks.unshift(task);
  save();
  closeSheet();
  toast('已添加');
  render();
  return task.id;
}

function toggleTaskDone(t) {
  if (t.done) {
    t.done = false;
    t.doneAt = null;
    vibrate(8);
    return;
  }
  if (t.subtasks.length) {
    t.subtasks.forEach(s => { if (!s.done) { s.done = true; s.doneAt = C.todayISO(); } });
  }
  t.done = true;
  t.doneAt = C.todayISO();
  t.spent = t.spent || 0;
  vibrate([10, 30, 20]);
}

function syncTaskDone(t) {
  if (!t.subtasks.length) return;
  const all = t.subtasks.every(s => s.done);
  if (all && !t.done) { t.done = true; t.doneAt = C.todayISO(); }
  if (!all && t.done) { t.done = false; t.doneAt = null; }
}

/* 账号操作的统一反馈：禁用按钮 + 提示 + 成功后续处理 */
function doAccountAction(fn, pendingText) {
  const btns = $$('.sheet-foot .btn');
  btns.forEach(b => { b.disabled = true; });
  toast(pendingText || '处理中…', 1400);
  fn().then(res => {
    btns.forEach(b => { b.disabled = false; });
    if (!res.ok) {
      toast(res.error || '操作失败');
      return;
    }
    afterLogin();
  }).catch(err => {
    btns.forEach(b => { b.disabled = false; });
    toast('操作失败：' + (err.message || '未知错误'));
  });
}

/* ---------------- 全局事件委托 ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const fn = ACTIONS[act];
  if (!fn) return;
  // 弹窗内部按钮已在别处绑定，避免重复触发
  if (el.closest('.overlay-internal')) return;
  try { fn(el, e); } catch (err) { console.error('action failed:', act, err); }
});

/* 设置项输入 */
document.addEventListener('change', e => {
  const el = e.target.closest('[data-set]');
  if (!el) return;
  const key = el.dataset.set;
  let v = el.value;
  if (el.type === 'number') {
    v = +v || 0;
    if (key === 'focusMax') v = C.clamp(v, 15, 120);
    if (key === 'breakLen') v = C.clamp(v, 0, 30);
    if (key === 'remindBefore') v = C.clamp(v, 1, 120);
    el.value = v;
  }
  S.settings[key] = v;
  save();
  toast('设置已更新');
  render();
});

/* 键盘：Esc 关闭弹窗 */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
});

/* 页面可见时重新渲染（跨天 / 回到前台） */
let lastDay = C.todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = C.todayISO();
  if (now !== lastDay) {
    lastDay = now;
    S.selDate = now;
    toast('新的一天，排程已更新');
    render();
  }
  checkReminders();
});

/* ---------------- 安装提示（PWA） ---------------- */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallEntry();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('已添加到主屏幕，之后从图标进入即可');
  updateInstallEntry();
});

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  } catch (e) {
    return false;
  }
}

function updateInstallEntry() {
  const el = document.querySelector('[data-install-entry]');
  if (!el) return;
  const show = !isStandalone() && !isFileProtocol();
  el.style.display = show ? '' : 'none';
}

/* ---------------- 启动 ---------------- */
function boot() {
  loadAuth();
  const has = load();
  // load() 内部若从自动备份恢复，会设置 S.recovered
  const recovered = S.recovered === true;

  if (!has) {
    // 从没存过东西的新用户 → 注入示例
    seedDemo();
  }

  // 记录本地最后修改时间（用于和云端比新旧）
  S.localUpdatedAt = Date.now();

  render();
  renderStorageBanner();
  paintSafariViewport();
  setupUpdateWatcher();
  renderSyncStatus();

  // 纯本地模式：不探测后端、不联网同步
  // 数据全部存在本机档案里

  // 换入口后从备份捞回数据 —— 明确告知用户
  if (recovered) {
    setTimeout(() => {
      try { openRecoveredSheet(); } catch (e) { console.warn('恢复提示失败', e); }
    }, 450);
  }
  setInterval(() => {
    checkReminders();
    if (S.view === 'today') {
      // 轻量刷新“接下来”和当前时间提示
      const nextEl = $('.hero-copy .small');
      if (nextEl) {
        const nowMin = C.currentMin();
        const plan = C.planDay({
          dateISO: C.todayISO(), tasks: S.tasks, events: S.events,
          settings: S.settings, nowISO: C.todayISO(), nowMin
        });
        const nb = C.nextBlock(plan.blocks, nowMin);
        if (!nb) return;
        const start = Math.max(nb.startMin, nowMin);
        nextEl.textContent = `${C.clockOf(start)} 开始 · ${C.fmtDuration(nb.minutes)} · 优先级 ${nb.score} 分`;
      }
    }
  }, 30000);
  setTimeout(checkReminders, 4000);
  // 切到后台前落盘，避免移动端被系统回收时丢数据
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}

function paintSafariViewport() {
  const setVh = () => {
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  };
  setVh();
  window.addEventListener('resize', setVh);
  // 仅在 https / localhost 下注册离线缓存
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ---------------- 自动更新检查 ---------------- */
/**
 * 网页/PWA 版：有新版本时提示用户刷新。
 * App 版：受系统限制，需要重新安装 APK（见 MAKE-APP.md）。
 */
function setupUpdateWatcher() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  navigator.serviceWorker.register('./sw.js').then(reg => {
    // 已有新版本在等待激活
    if (reg.waiting) notifyUpdateReady();

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          notifyUpdateReady();
        }
      });
    });

    // 每小时检查一次
    setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
  }).catch(() => {});
}

let updateNotified = false;
function notifyUpdateReady() {
  if (updateNotified) return;
  updateNotified = true;
  setTimeout(() => {
    openSheet({
      title: '有新版本可用',
      body: `
        <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 24%,transparent)">
          ${icon('spark')}
          <div>检测到新版本已下载完成。刷新后即可使用，<b>你的任务数据不受影响</b>。</div>
        </div>
        <div class="card" style="padding:14px;background:var(--paper);box-shadow:none;border:1px solid var(--line-soft);margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0">
            <span class="muted">当前版本</span><b>${esc(appVersion())}</b>
          </div>
        </div>
      `,
      foot: `<button class="btn ghost" data-act="sheet-close">稍后</button>
             <button class="btn primary" data-act="apply-update">立即刷新</button>`
    });
  }, 3500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
