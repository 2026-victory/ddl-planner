/* ==========================================================================
 * views.js —— 四个主页面 + 各弹窗（任务表单 / 详情 / 拆解 / 设置）
 * ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- 顶栏 */
function renderTopbar() {
  const tb = $('#topbar');
  const today = C.todayISO();
  const d = C.parseISO(today);
  const map = {
    today: ['今天', `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${C.weekdayOf(today)}`],
    calendar: ['日历', '看看这个月要怎么过'],
    tasks: ['全部任务', `${S.tasks.filter(t => !t.done).length} 个待办 · 按优先级排序`],
    settings: ['设置', '作息与提醒偏好']
  };
  const [title, sub] = map[S.view] || map.today;
  tb.innerHTML = `
    <div class="topbar-inner">
      <div>
        <h1>${esc(title)}</h1>
        <div class="sub">${esc(sub)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        ${S.view === 'today' ? `<span class="brand"><span class="dot"></span>智能排程</span>` : ''}
        ${S.view === 'calendar' ? `<button class="btn sm ghost" data-act="goto-today">回到今天</button>` : ''}
        <button class="account-btn" data-act="open-account" title="账号与同步">
          ${icon('me')}
          <span class="nm">${isLoggedIn() ? esc(Cloud.username) : '登录'}</span>
        </button>
        <div class="sync-bar" data-sync-status></div>
      </div>
    </div>`;
  renderSyncStatus();
}

/* ---------------------------------------------------------------- 底栏 */
function renderTabbar() {
  const tabs = [
    ['today', 'today', '今天'],
    ['calendar', 'cal', '日历'],
    ['ADD', 'plus', ''],
    ['tasks', 'list', '任务'],
    ['settings', 'me', '设置']
  ];
  $('#tabbar').innerHTML = `<div class="tabbar-inner">${tabs.map(([k, ic, label]) => {
    if (k === 'ADD') {
      return `<button class="tab-add" data-act="add" aria-label="新建任务">${icon('plus')}</button>`;
    }
    return `<button class="tab ${S.view === k ? 'on' : ''}" data-act="tab" data-tab="${k}">
      ${icon(ic)}<span>${label}</span></button>`;
  }).join('')}</div>`;
}

/* ---------------------------------------------------------------- 今天 */
function renderToday(view) {
  const today = C.todayISO();
  const nowMin = C.currentMin();
  const plan = C.planDay({
    dateISO: today, tasks: S.tasks, events: S.events,
    settings: S.settings, nowISO: today, nowMin
  });
  const active = S.tasks.filter(t => !t.done);
  const doneToday = S.tasks.filter(t => t.done && t.doneAt === today);
  const allDone = S.tasks.filter(t => t.done).length;
  const next = C.nextBlock(plan.blocks, nowMin);
  const todayTasks = C.sortTasks(
    active.filter(t => t.due && C.daysBetween(today, t.due) <= 0), today
  ).map(x => x.task);
  const scheduled = plan.stats.scheduled;
  const cap = Math.max(plan.stats.capacity, scheduled);
  const pct = cap ? Math.round(scheduled / cap * 100) : 0;
  const backlog = active.reduce((s, t) => s + C.remainingMinutes(t), 0);

  // 进度环
  const R = 40, CIRC = 2 * Math.PI * R;
  const ringPct = Math.min(100, pct);

  const ring = `
    <div class="ring">
      <svg viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="${R}" fill="none" stroke-width="7"></circle>
        <circle class="bar" cx="50" cy="50" r="${R}" fill="none" stroke-width="7"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - ringPct / 100)}"></circle>
      </svg>
      <div class="ring-label"><b>${ringPct}%</b><span>今日负荷</span></div>
    </div>`;

  const doneMinutes = plan.blocks.filter(b => b.kind === 'work' && b.endMin <= nowMin)
    .reduce((a, b) => a + b.minutes, 0);

  const headline = active.length === 0
    ? '待办清空了'
    : next
      ? `接下来：${C.shortTitle(next.title, 14)}`
      : '今天的工作已排满';

  const subline = active.length === 0
    ? `今天完成了 ${doneToday.length} 项，好好休息。`
    : next
      ? `${C.clockOf(Math.max(next.startMin, nowMin))} 开始 · ${C.fmtDuration(next.minutes)} · 优先级 ${next.score} 分`
      : plan.stats.scheduled
        ? `今天排了 ${C.fmtHours(plan.stats.scheduled)}，剩下的明天继续。`
        : '今天没有必须做的事，可以提前推进大任务。';

  // 周条
  const dow = C.parseISO(today).getDay();
  const weekStart = C.addDaysISO(today, -dow);
  const chips = Array.from({ length: 7 }, (_, i) => {
    const iso = C.addDaysISO(weekStart, i);
    const d = C.parseISO(iso);
    const dueCount = active.filter(t => t.due === iso).length;
    const load = currentDayLoad(iso);
    return `<button class="day-chip ${iso === today ? 'today' : ''}" data-act="pick-day" data-date="${iso}">
      <span class="wd">${'日一二三四五六'[d.getDay()]}</span>
      <span class="dnum">${d.getDate()}</span>
      <span class="dots">${Array.from({ length: 3 }, (_, k) =>
        `<i class="${k < Math.min(3, Math.ceil(dueCount + (load > 0 ? 1 : 0))) ? (dueCount > 0 ? 'hot' : 'on') : ''}"></i>`
      ).join('')}</span>
    </button>`;
  }).join('');

  // 时间线
  const blocksHtml = plan.blocks.length
    ? plan.blocks.map(b => {
      if (b.kind === 'break') {
        return `<div class="tl-row"><div class="tl-time">${b.start}</div>
          <div class="tl-body"><div class="block brk"><div class="b-main">
            <div class="b-title">☕️ 休息 ${b.minutes} 分钟 · 起来走走</div></div></div></div></div>`;
      }
      const pr = b.score >= 75 ? 'p1' : b.score >= 55 ? 'p2' : b.score >= 35 ? 'p3' : 'p4';
      const isNow = nowMin >= b.startMin && nowMin < b.endMin;
      return `<div class="tl-row"><div class="tl-time">${b.start}</div>
        <div class="tl-body"><div class="block ${pr}" data-act="open-task" data-id="${b.taskId}">
          <div class="b-main">
            <div class="b-title">${esc(b.title)}</div>
            <div class="b-meta">
              <span class="b-time">${b.start}–${b.end}</span>
              <span class="b-dur">${b.minutes} 分钟</span>
              ${isNow ? '<span style="color:var(--accent);font-weight:700">进行中</span>' : ''}
              ${b.score ? `<span>· 优先级 ${b.score}</span>` : ''}
            </div>
          </div>
          <button class="b-go" data-act="focus-block" data-id="${b.taskId}" data-sub="${b.subId || ''}"
            data-min="${b.minutes}" data-title="${esc(b.title)}" aria-label="开始专注">${icon('play')}</button>
        </div></div></div>`;
    }).join('')
    : `<div class="empty">
        <div class="emoji">🌤</div>
        <h3>今天没有必须做的事</h3>
        <p>把想推进的任务加上，我会自动排进合适的时间段。</p>
        <div class="actions">
          <button class="btn primary" data-act="add">添加任务</button>
          ${active.length ? '<button class="btn" data-act="plan-week">安排到未来</button>' : ''}
        </div>
      </div>`;

  // 到期任务
  const dueHtml = todayTasks.length
    ? `<div class="task-list">${todayTasks.map(t => taskCard(t)).join('')}</div>`
    : '';

  const warn = plan.warnings.slice(0, 2).map(w =>
    `<div class="notice ${/逾期/.test(w) ? 'danger' : ''}">${icon('flag')}<div>${esc(w)}</div></div>`
  ).join('');

  view.innerHTML = `
    <section class="card hero">
      <div class="hero-top">
        <span class="hero-date">${C.weekdayOf(today)} · ${C.parseISO(today).getMonth() + 1}月${C.parseISO(today).getDate()}日</span>
        <span class="streak">${icon('check')} 连续 ${streakDays()} 天有进度</span>
      </div>
      <div class="hero-main">
        ${ring}
        <div class="hero-copy">
          <div class="big">${esc(headline)}</div>
          <div class="small">${esc(subline)}</div>
        </div>
      </div>
      <div class="capacity">
        <div class="capacity-head">
          <span>今日时间投入</span>
          <span><b>${C.fmtHours(scheduled)}</b> / ${C.fmtHours(cap)} 可用</span>
        </div>
        <div class="bar">
          <i style="width:${Math.min(100, ringPct)}%;background:${ringPct > 88 ? 'var(--accent)' : 'var(--jade)'}"></i>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat accent"><b>${todayTasks.filter(t => !t.done).length}</b><span>今天到期</span></div>
        <div class="stat"><b>${C.fmtHours(scheduled)}</b><span>今日计划</span></div>
        <div class="stat jade"><b>${C.fmtHours(backlog)}</b><span>全部任务余量</span></div>
      </div>
      <div class="weekstrip">${chips}</div>
    </section>

    ${warn ? `<div style="margin-top:14px">${warn}</div>` : ''}

    <section class="section">
      <div class="section-head">
        <h2>今日安排 <span class="count">${plan.blocks.filter(b => b.kind === 'work').length} 段</span></h2>
        <button class="link" data-act="replan">重新排程 ${icon('spark')}</button>
      </div>
      <div class="card timeline">${blocksHtml}</div>
    </section>

    ${dueHtml ? `<section class="section">
      <div class="section-head">
        <h2>今天要交的 <span class="count">${todayTasks.filter(t => !t.done).length}</span></h2>
        <button class="link" data-act="tab" data-tab="tasks">全部 ${icon('chev')}</button>
      </div>
      ${dueHtml}
    </section>` : ''}
  `;
}

function currentDayLoad(iso) {
  const p = C.planDay({ dateISO: iso, tasks: S.tasks, events: S.events, settings: S.settings, nowISO: C.todayISO() });
  return p.stats.scheduled;
}

function streakDays() {
  // 统计最近有完成记录的天数（连续）
  const doneDates = new Set(S.tasks.filter(t => t.done && t.doneAt).map(t => t.doneAt));
  let n = 0, cursor = C.todayISO();
  if (!doneDates.has(cursor)) cursor = C.addDaysISO(cursor, -1);
  while (doneDates.has(cursor) && n < 365) { n++; cursor = C.addDaysISO(cursor, -1); }
  return n;
}

/* ---------------------------------------------------------------- 任务卡 */
function taskCard(t) {
  const today = C.todayISO();
  const st = C.statusOf(t, today);
  const sc = C.scoreOf(t, today);
  const prog = C.progressOf(t);
  const remain = C.remainingMinutes(t);
  const dueCls = st === 'overdue' ? 'due-over' : st === 'today' ? 'due-today' : '';
  const badgeCls = t.done ? 'ok' : sc.score >= 75 ? 'hot' : sc.score >= 55 ? 'warm' : sc.score >= 35 ? 'cool' : 'calm';
  const badge = t.done ? '已完成' : sc.score + ' 分';
  const subCount = t.subtasks.length;
  const subDone = t.subtasks.filter(s => s.done).length;

  return `<div class="task ${t.done ? 'done' : ''}" data-act="open-task" data-id="${t.id}">
    <button class="check ${t.done ? 'on' : ''}" data-act="toggle-task" data-id="${t.id}" aria-label="完成">${icon('check')}</button>
    <div class="t-main">
      <div class="t-top">
        <div class="t-title">${esc(t.title)}</div>
        <span class="badge ${badgeCls}">${badge}</span>
      </div>
      <div class="t-meta">
        <span class="m ${dueCls}">${icon('clock')}${esc(C.dueLabel(t, today))}</span>
        <span class="m">${icon('flag')}难度 ${t.difficulty} · 重要 ${t.importance}</span>
        ${remain > 0 && !t.done ? `<span class="m">剩 ${C.fmtDuration(remain)}</span>` : ''}
        ${subCount ? `<span class="m">${subDone}/${subCount} 步</span>` : ''}
      </div>
      ${!t.done && subCount ? `<div class="t-prog"><div class="bar"><i style="width:${prog}%"></i></div><span>${prog}%</span></div>` : ''}
      ${t.note ? `<div class="t-note">${esc(t.note)}</div>` : ''}
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- 全部任务 */
function renderTasks(view) {
  const today = C.todayISO();
  const counts = {
    all: S.tasks.filter(t => !t.done).length,
    overdue: S.tasks.filter(t => !t.done && C.statusOf(t, today) === 'overdue').length,
    today: S.tasks.filter(t => !t.done && C.statusOf(t, today) === 'today').length,
    soon: S.tasks.filter(t => !t.done && C.statusOf(t, today) === 'soon').length,
    done: S.tasks.filter(t => t.done).length
  };
  const filters = [
    ['all', '全部'], ['overdue', '逾期'], ['today', '今天'],
    ['soon', '3 天内'], ['done', '已完成']
  ];

  let list = S.tasks.slice();
  if (S.filter === 'done') list = list.filter(t => t.done);
  else {
    list = list.filter(t => !t.done);
    if (S.filter !== 'all') list = list.filter(t => C.statusOf(t, today) === S.filter);
  }
  if (S.query.trim()) {
    const q = S.query.trim().toLowerCase();
    list = list.filter(t => (t.title + ' ' + t.note).toLowerCase().includes(q));
  }
  const sorted = S.filter === 'done'
    ? list.sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
    : C.sortTasks(list, today).map(x => x.task);

  const html = sorted.length
    ? `<div class="task-list">${sorted.map(t => taskCard(t)).join('')}</div>`
    : `<div class="card empty">
        <div class="emoji">${S.filter === 'done' ? '📦' : '✨'}</div>
        <h3>${S.query ? '没找到匹配的任务' : S.filter === 'done' ? '还没有完成的任务' : '这里空空的'}</h3>
        <p>${S.query ? '换个关键词试试。' : '把脑子里的待办丢进来，我来排序和排时间。'}</p>
        <div class="actions"><button class="btn primary" data-act="add">新建任务</button></div>
      </div>`;

  view.innerHTML = `
    <div class="search">
      ${icon('list', 'ic')}
      <input id="q" type="search" placeholder="搜索任务…" value="${esc(S.query)}" autocomplete="off">
    </div>
    <div class="filters">
      ${filters.map(([k, label]) =>
        `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-key="${k}">${label}<span class="n">${counts[k]}</span></button>`
      ).join('')}
    </div>
    <div class="section-head" style="margin:2px 4px 10px">
      <h2>${S.filter === 'done' ? '已完成' : '按优先级排序'} <span class="count">${sorted.length}</span></h2>
      <button class="link" data-act="plan-week">排到未来 ${icon('chev')}</button>
    </div>
    ${html}
  `;

  const q = $('#q');
  if (q) {
    q.addEventListener('input', e => {
      S.query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const nq = $('#q');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });
  }
}

/* ---------------------------------------------------------------- 日历 */
function renderCalendar(view) {
  const today = C.todayISO();
  const y = S.calY, m = S.calM;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const dim = C.daysInMonth(y, m);
  const prevDim = C.daysInMonth(y, m === 0 ? 11 : m - 1);

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevDim - i;
    const iso = C.toISO(new Date(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, d));
    cells.push({ iso, n: d, out: true });
  }
  for (let d = 1; d <= dim; d++) cells.push({ iso: C.toISO(new Date(y, m, d)), n: d, out: false });
  const tail = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= tail; d++) {
    cells.push({ iso: C.toISO(new Date(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, d)), n: d, out: true });
  }

  const cellHtml = cells.map(c => {
    const due = S.tasks.filter(t => !t.done && t.due === c.iso);
    const ev = S.events.filter(e => e.date === c.iso);
    const overduePending = due.some(t => C.daysBetween(c.iso, t.due) < 0);
    const load = currentDayLoad(c.iso);
    const dots = [];
    if (due.length) dots.push(`<i class="dot ${due.some(t => t.importance >= 4) ? 'hot' : 'warm'}"></i>`);
    if (ev.length) dots.push('<i class="dot cool"></i>');
    if (!due.length && load > 0) dots.push('<i class="dot ok"></i>');
    return `<button class="cell ${c.out ? 'out' : ''} ${c.iso === today ? 'today' : ''} ${c.iso === S.selDate ? 'sel' : ''}"
      data-act="pick-day" data-date="${c.iso}">
      <span class="n">${c.n}</span>
      <span class="dots">${dots.slice(0, 3).join('')}</span>
    </button>`;
  }).join('');

  // 选中日的日程
  const dayTasks = C.sortTasks(S.tasks.filter(t => t.due === S.selDate && !t.done), today).map(x => x.task);
  const dayDone = S.tasks.filter(t => t.done && (t.due === S.selDate || t.doneAt === S.selDate));
  const dayEvents = S.events.filter(e => e.date === S.selDate);
  const plan = C.planDay({
    dateISO: S.selDate, tasks: S.tasks, events: S.events, settings: S.settings,
    nowISO: today, nowMin: S.selDate === today ? C.currentMin() : null
  });
  const isPast = S.selDate < today;

  const agenda = dayTasks.length || dayEvents.length
    ? `<div class="task-list">
        ${dayEvents.map(e => `<div class="task" style="background:var(--sky-soft);border-color:transparent">
          <div class="t-main">
            <div class="t-top"><div class="t-title">${esc(e.title)}</div><span class="badge cool">固定安排</span></div>
            <div class="t-meta"><span class="m">${icon('clock')}${e.start}–${e.end}</span></div>
          </div>
          <button class="del" data-act="del-event" data-id="${e.id}" style="color:var(--ink-3);align-self:center">${icon('trash')}</button>
        </div>`).join('')}
        ${dayTasks.map(t => taskCard(t)).join('')}
      </div>`
    : `<div class="card empty">
        <div class="emoji">${isPast ? '🗂' : '📅'}</div>
        <h3>${isPast ? '这天没有记录' : '这天还是空的'}</h3>
        <p>${isPast ? '过去了就过去吧，重点看前面。' : '可以加个任务，或者先放个固定安排（上课、通勤）。'}</p>
        <div class="actions">
          <button class="btn primary" data-act="add" data-date="${S.selDate}">加任务</button>
          <button class="btn" data-act="add-event" data-date="${S.selDate}">加固定安排</button>
        </div>
      </div>`;

  view.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <div class="ym">${y} 年 ${m + 1} 月<small>${plan.stats.scheduled ? '已排 ' + C.fmtHours(plan.stats.scheduled) : ''}</small></div>
        <div class="nav-btns">
          <button class="nav-btn prev" data-act="cal-prev" aria-label="上个月">${icon('chev')}</button>
          <button class="nav-btn" data-act="cal-next" aria-label="下个月">${icon('chev')}</button>
        </div>
      </div>
      <div class="cal-grid">
        <div class="cal-wd">${['日', '一', '二', '三', '四', '五', '六'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-cells">${cellHtml}</div>
      </div>
    </div>

    <div class="agenda-title">
      <b>${S.selDate === today ? '今天' : `${C.parseISO(S.selDate).getMonth() + 1}月${C.parseISO(S.selDate).getDate()}日`}</b>
      <span>${C.weekdayOf(S.selDate)}${dayDone.length ? ` · 已完成 ${dayDone.length} 项` : ''}</span>
      <div style="flex:1"></div>
      ${plan.blocks.filter(b => b.kind === 'work').length ? `<span class="muted" style="font-size:11.5px">自动排了 ${plan.blocks.filter(b => b.kind === 'work').length} 段</span>` : ''}
    </div>
    ${agenda}

    ${plan.blocks.filter(b => b.kind === 'work').length ? `
      <div class="agenda-title"><b>当天建议行程</b><span>按优先级自动生成</span></div>
      <div class="card timeline">${plan.blocks.filter(b => b.kind === 'work').slice(0, 6).map(b => {
        const pr = b.score >= 75 ? 'p1' : b.score >= 55 ? 'p2' : b.score >= 35 ? 'p3' : 'p4';
        return `<div class="tl-row"><div class="tl-time">${b.start}</div>
          <div class="tl-body"><div class="block ${pr}" data-act="open-task" data-id="${b.taskId}">
            <div class="b-main"><div class="b-title">${esc(b.title)}</div>
            <div class="b-meta"><span class="b-time">${b.start}–${b.end}</span><span class="b-dur">${b.minutes} 分钟</span></div></div>
          </div></div></div>`;
      }).join('')}</div>` : ''}
  `;
}

/* ---------------------------------------------------------------- 数据找回提示 */
function openRecoveredSheet() {
  const when = S.recoveredAt ? new Date(S.recoveredAt) : null;
  const whenText = when
    ? `${when.getMonth() + 1}月${when.getDate()}日 ${C.pad2(when.getHours())}:${C.pad2(when.getMinutes())}`
    : '上次';
  openSheet({
    title: '已找回你上次的数据',
    body: `
      <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 24%,transparent)">
        ${icon('spark')}
        <div>这次是用和上次<b>不一样的入口</b>打开页面（例如重新添加到桌面、换了浏览器或换了文件位置）。
        浏览器会给每个入口单独的存储空间，所以本来是空的 —— 已自动从备份恢复。</div>
      </div>
      <div class="card" style="padding:14px;background:var(--paper);box-shadow:none;border:1px solid var(--line-soft);margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0">
          <span class="muted">恢复的任务</span><b>${S.tasks.length} 个</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0">
          <span class="muted">固定安排</span><b>${S.events.length} 项</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0">
          <span class="muted">备份时间</span><b>${esc(whenText)}</b>
        </div>
      </div>
      <div class="notice" style="margin-top:12px">
        ${icon('flag')}
        <div><b>怎么彻底避免再出现：</b>不要用「添加到桌面」打开本地 HTML 文件。
        请改用下面「设置」里的稳定方式，或每次都从同一个浏览器书签进入。</div>
      </div>
      <button class="btn ghost" style="width:100%;margin-top:10px" data-act="goto-settings">
        去设置看看怎么稳定保存
      </button>
    `,
    foot: `<button class="btn primary" data-act="sheet-close">知道我数据还在，继续用</button>`
  });
}

/* ---------------------------------------------------------------- 存储位置说明 */
function isFileProtocol() {
  try { return location.protocol === 'file:'; } catch (e) { return false; }
}

function storageDescription() {
  if (!S.storageOk) return '存储不可用，记录无法保存，请换普通窗口打开';
  const bk = readAutoBackup();
  const when = bk && bk.savedAt ? new Date(bk.savedAt) : null;
  const whenText = when
    ? `${when.getMonth() + 1}月${when.getDate()}日 ${C.pad2(when.getHours())}:${C.pad2(when.getMinutes())}`
    : '';
  if (isFileProtocol()) {
    return '以本地文件方式打开。数据只存在「当前这个入口」，换入口会读不到'
      + (whenText ? `（自动备份：${whenText}）` : '');
  }
  return '以网页方式打开，数据稳定保存在本站点'
    + (whenText ? `（自动备份：${whenText}）` : '');
}

/* ---------------------------------------------------------------- 为什么没有后端 */
function openWhyNoServer() {
  openSheet({
    title: '为什么账号用不了',
    body: `
      <div class="notice danger">
        ${icon('flag')}
        <div><b>你现在访问的是一个「纯静态网页」。</b></div>
      </div>
      <div style="font-size:13px;line-height:1.75;color:var(--ink-2);margin-top:12px">
        <p style="margin:0 0 10px">静态托管（GitHub Pages、Vercel 静态、Netlify）只能存放
        HTML / CSS / JS 文件，它<b>不能运行服务器程序</b>。而注册、登录、存云端数据都需要一个
        真正在运行的后端，所以这些按钮点了会失败。</p>
        <p style="margin:0 0 10px"><b style="color:var(--ink)">但这不影响你正常用：</b>
        任务、日历、自动排程、专注计时全部照常工作，数据存在你手机浏览器里，
        也能「备份数据」导出文件。</p>
        <p style="margin:0"><b style="color:var(--ink)">如果你确实需要账号同步</b>，
        那就得把带后端的版本部署上去（不能只放静态文件）。</p>
      </div>

      <div class="detail-section-title" style="margin-top:18px"><span>两种方案</span></div>

      <div class="card" style="padding:14px 16px;box-shadow:none;border:1px solid var(--line-soft)">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:var(--ink)">
          方案 A：不要账号，只用本地（最简单）
        </p>
        <p style="margin:0;font-size:12.5px;line-height:1.7;color:var(--ink-2)">
          继续用现在的静态网址 + 浏览器书签。定期在设置里「备份数据」导出 JSON 存到网盘即可。
          换手机时用「恢复数据」导入。
        </p>
      </div>

      <div class="card" style="padding:14px 16px;box-shadow:none;border:1px solid var(--line-soft);margin-top:10px">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:var(--ink)">
          方案 B：部署带后端的版本（要账号就用这个）
        </p>
        <p style="margin:0 0 8px;font-size:12.5px;line-height:1.7;color:var(--ink-2)">
          把项目里的 <code>server.js</code> 和 <code>app/</code> 一起部署到
          <b>Render</b>、<b>Railway</b> 这类能跑 Node 的平台（不是静态托管）。
          拿到网址后，账号就能用了。
        </p>
        <p style="margin:0;font-size:12px;line-height:1.7;color:var(--ink-3)">
          具体步骤写在项目根目录的 <code>DEPLOY.md</code> 里，含每一步该填什么。
        </p>
      </div>

      <div class="notice" style="margin-top:12px">
        ${icon('check')}
        <div>判断方法：如果网址的账号界面里<b>没有</b>这条红色提示，说明后端是通的，账号就能用。</div>
      </div>
    `,
    foot: `<button class="btn primary" data-act="sheet-close">知道了</button>`
  });
}

/* ---------------------------------------------------------------- 安装引导 */
function openInstallGuide() {
  const file = isFileProtocol();
  openSheet({
    title: file ? '怎么让它稳定打开' : '添加到主屏幕',
    body: `
      ${file ? `
      <div class="notice danger">
        ${icon('flag')}
        <div><b>当前是「本地文件」打开方式，添加到桌面不可靠。</b><br>
        手机浏览器不允许桌面快捷方式冷启动本地 HTML，所以第二天常打不开；
        而重新添加又会换一个存储空间，数据就像被清空了。</div>
      </div>
      <div class="detail-section-title"><span>推荐做法（任选一个）</span></div>
      <div class="card" style="padding:14px 16px;font-size:12.5px;line-height:1.75;color:var(--ink-2);box-shadow:none;border:1px solid var(--line-soft)">
        <p style="margin:0 0 10px"><b style="color:var(--ink)">① 用书签，别用桌面图标</b><br>
        在浏览器里打开后，加入收藏夹/书签。以后从书签进入，存储空间永远不变。</p>
        <p style="margin:0 0 10px"><b style="color:var(--ink)">② 放到网上访问（最稳定）</b><br>
        把 <code>app/</code> 目录传到任意静态托管（GitHub Pages / Vercel / Netlify），
        得到 https 网址后再「添加到主屏幕」，就能像 App 一样用，且数据稳定。</p>
        <p style="margin:0"><b style="color:var(--ink)">③ 手机本地起服务</b><br>
        电脑上跑 <code>node test/serve.js 5173</code>，手机连同一 Wi-Fi 访问
        <code>http://电脑IP:5173</code>。</p>
      </div>
      <div class="notice" style="margin-top:12px">
        ${icon('check')}
        <div>无论用哪种方式，<b>换入口后只要点「找回上次数据」</b>就能把任务捞回来（自动备份仍然存在同一浏览器里）。</div>
      </div>
      ` : `
      <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 24%,transparent)">
        ${icon('spark')}
        <div>你现在用的是网页版，可以正式「添加到主屏幕」，之后从图标进入，数据会一直保存在这个站点。</div>
      </div>
      <div class="detail-section-title"><span>操作步骤</span></div>
      <div class="card" style="padding:14px 16px;font-size:12.5px;line-height:1.8;color:var(--ink-2);box-shadow:none;border:1px solid var(--line-soft)">
        <p style="margin:0 0 8px"><b style="color:var(--ink)">iPhone / Safari</b><br>
        点底部「分享」按钮 → 向下滑找到「添加到主屏幕」→ 添加。</p>
        <p style="margin:0"><b style="color:var(--ink)">安卓 / Chrome</b><br>
        点右上角「⋮」→「安装应用」或「添加到主屏幕」。也可直接点下面的按钮。</p>
      </div>
      `}
    `,
    foot: file
      ? `<button class="btn primary" data-act="sheet-close">知道了</button>`
      : `<button class="btn ghost" data-act="sheet-close">稍后</button>
         <button class="btn primary" data-act="install-app">添加到主屏幕</button>`
  });
}

/* ---------------------------------------------------------------- 设置 */
function renderSettings(view) {
  const s = S.settings;
  const notifPerm = window.Notification ? Notification.permission : 'unsupported';
  view.innerHTML = `
    <div class="card set-group">
      <div class="set-row">
        <div class="label">
          <b>账号与同步</b>
          <span>${isLoggedIn()
            ? '已登录 ' + esc(Cloud.username) + '，数据自动同步到云端'
            : '登录后换设备也能取回全部安排'}</span>
        </div>
        <button class="btn sm ${isLoggedIn() ? 'ghost' : 'primary'}" data-act="open-account">
          ${isLoggedIn() ? '管理' : '登录'}
        </button>
      </div>
    </div>

    <div class="card set-group" style="margin-top:14px">
      <div class="set-row">
        <div class="label"><b>每天开始时间</b><span>排程从这时往后面安排</span></div>
        <input type="time" value="${esc(s.workStart)}" data-set="workStart">
      </div>
      <div class="set-row">
        <div class="label"><b>每天结束时间</b><span>超过这个点不再排任务</span></div>
        <input type="time" value="${esc(s.workEnd)}" data-set="workEnd">
      </div>
      <div class="set-row">
        <div class="label"><b>单块专注时长</b><span>一个时间块最多连续做多久</span></div>
        <input type="number" min="15" max="120" step="5" value="${s.focusMax}" data-set="focusMax">
      </div>
      <div class="set-row">
        <div class="label"><b>块间休息</b><span>每段工作之间插入的休息分钟数</span></div>
        <input type="number" min="0" max="30" step="5" value="${s.breakLen}" data-set="breakLen">
      </div>
    </div>

    <div class="card set-group" style="margin-top:14px">
      <div class="set-row">
        <div class="label"><b>到期提醒</b><span>任务到点前弹出通知</span></div>
        <button class="switch ${s.reminders ? 'on' : ''}" data-act="toggle-remind" aria-label="提醒开关"></button>
      </div>
      <div class="set-row">
        <div class="label"><b>提前多久提醒</b><span>默认到期前 ${s.remindBefore} 分钟</span></div>
        <input type="number" min="1" max="120" step="1" value="${s.remindBefore}" data-set="remindBefore">
      </div>
      <div class="set-row">
        <div class="label"><b>浏览器通知</b><span>${
          notifPerm === 'granted' ? '已开启，关掉页面仍可提醒' :
          notifPerm === 'denied' ? '已被浏览器拒绝，可在站点设置里恢复' :
          notifPerm === 'unsupported' ? '当前环境不支持系统通知' : '开启后提醒更醒目'
        }</span></div>
        <button class="btn sm ${notifPerm === 'granted' ? '' : 'ghost'}" data-act="ask-notify">
          ${notifPerm === 'granted' ? '已开启' : '开启'}
        </button>
      </div>
    </div>

    <div class="card set-group" style="margin-top:14px">
      <div class="set-row">
        <div class="label">
          <b>当前存储位置</b>
          <span>${esc(storageDescription())}</span>
        </div>
        <span class="pill ${isFileProtocol() ? 'amber' : 'jade'}">${isFileProtocol() ? '本地文件' : '网页版'}</span>
      </div>
      ${isFileProtocol() ? `
      <div class="set-row" style="align-items:flex-start">
        <div class="label">
          <b style="color:var(--accent)">⚠️ 不推荐「添加到桌面」</b>
          <span>本地 HTML 文件添加到桌面后，第二天常常打不开；重新添加会换一个存储空间，数据看起来像被清空。
          建议：用浏览器「书签/收藏」进入，或改用下面的稳定方案。</span>
        </div>
      </div>` : ''}
      <div class="set-row">
        <div class="label"><b>添加到主屏幕</b><span>${
          isFileProtocol()
            ? '本地文件模式下不可靠，点开看正确做法'
            : '添加到桌面，之后从图标进入（数据稳定）'
        }</span></div>
        <button class="btn sm ${isFileProtocol() ? 'danger' : 'ghost'}" data-act="install-app">
          ${isFileProtocol() ? '看说明' : '添加'}
        </button>
      </div>
      <div class="set-row">
        <div class="label"><b>导出到日历</b><span>下载 .ics，可导入手机自带日历（含截止与行程）</span></div>
        <button class="btn sm ghost" data-act="export-ics">导出</button>
      </div>
      <div class="set-row">
        <div class="label"><b>备份数据</b><span>导出 JSON 文件，换设备 / 换入口时都能恢复</span></div>
        <button class="btn sm ghost" data-act="export-json">备份</button>
      </div>
      <div class="set-row">
        <div class="label"><b>恢复数据</b><span>选择之前备份的 JSON 文件</span></div>
        <button class="btn sm ghost" data-act="import-json">恢复</button>
      </div>
      ${readAutoBackup() ? `
      <div class="set-row">
        <div class="label"><b>找回上次数据</b><span>从自动备份恢复（换入口后数据"消失"时用）</span></div>
        <button class="btn sm ghost" data-act="restore-autobackup">找回</button>
      </div>` : ''}
      <div class="set-row">
        <div class="label">
          <b>检查更新</b>
          <span>当前版本 ${esc(appVersion())}${appBuildTime() ? ' · ' + esc(appBuildTime()) : ''}</span>
        </div>
        <button class="btn sm ghost" data-act="check-update">检查</button>
      </div>
      <div class="set-row">
        <div class="label"><b>清空示例数据</b><span>删除所有任务与安排，回到空白状态</span></div>
        <button class="btn sm danger" data-act="reset-all">清空</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>怎么用</h2></div>
      <div class="card" style="padding:14px 16px;font-size:12.5px;line-height:1.75;color:var(--ink-2)">
        <p style="margin:0 0 8px"><b style="color:var(--ink)">1 · 一句话添加</b><br>
        点中间 + 号，直接打字：“周五下午3点前交论文初稿，大概要5小时，很难”。日期、时间、时长、难度都会被自动识别。</p>
        <p style="margin:0 0 8px"><b style="color:var(--ink)">2 · 自动排序</b><br>
        打分 = 紧急度 40% + 重要度 30% + 难度 15% + 工作量 15%。分数越高越该先做。</p>
        <p style="margin:0 0 8px"><b style="color:var(--ink)">3 · 拆大任务</b><br>
        任务详情里点「智能拆解」，会按论文 / 编程 / 备考 / 汇报等场景给出步骤、每步工时和建议日期。</p>
        <p style="margin:0 0 8px"><b style="color:var(--ink)">4 · 排进时间线</b><br>
        今天页会自动把任务切成 25~45 分钟的时间块，避开固定安排，块间留休息。</p>
        <p style="margin:0"><b style="color:var(--ink)">5 · 专注与提醒</b><br>
        点时间块上的 ▶ 进入专注；到期前按设定的分钟数提醒你。</p>
      </div>
    </div>

    <div class="center muted" style="font-size:11px;padding:22px 0 6px">
      DDL 不慌 · 数据本地存储，可登录同步<br>
      <span style="opacity:.75">版本 ${esc(appVersion())}${appBuildTime() ? ' · 构建于 ' + esc(appBuildTime()) : ''}</span>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden">
  `;

  const file = $('#import-file');
  if (file) {
    file.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          S.tasks = (d.tasks || []).map(C.normalizeTask);
          S.events = d.events || [];
          S.settings = Object.assign({}, C.DEFAULT_SETTINGS, d.settings || {});
          save(); render(); toast('已恢复 ' + S.tasks.length + ' 个任务');
        } catch (err) { toast('文件格式不对'); }
      };
      reader.readAsText(f);
    });
  }
}

/* ---------------------------------------------------------------- 新建 / 编辑任务 */
function openTaskEditor(taskId, presetDate) {
  const editing = taskId ? taskById(taskId) : null;
  const t = editing || C.normalizeTask({
    due: presetDate || C.todayISO(),
    estimate: 60,
    difficulty: 3,
    importance: 3
  });
  const isNew = !editing;

  openSheet({
    title: isNew ? '新建任务' : '编辑任务',
    body: `
      ${isNew ? `<div class="field">
        <label>一句话描述 <span class="hint">日期 / 时长 / 难度都能自动识别</span></label>
        <textarea class="textarea" id="quick" rows="2"
          placeholder="例：周五下午3点前交实验报告，大概要4小时，很难"></textarea>
        <div class="parse-preview" id="preview"></div>
      </div>
      <div class="field"><label>或者直接填 <span class="hint">下面字段可修改</span></label></div>` : ''}
      <div class="field">
        <label>任务标题</label>
        <input class="input big" id="f-title" value="${esc(t.title)}" placeholder="要做什么？">
      </div>
      <div class="row2">
        <div class="field">
          <label>截止日期</label>
          <input class="input" type="date" id="f-due" value="${t.due || ''}">
        </div>
        <div class="field">
          <label>截止时间 <span class="hint">可选</span></label>
          <input class="input" type="time" id="f-due-time" value="${t.dueTime || ''}">
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>预计工时 <span class="hint">分钟</span></label>
          <input class="input" type="number" id="f-est" min="5" step="5" value="${Math.max(5, t.estimate || 60)}">
        </div>
      <div class="field">
        <label>工时快选</label>
        <div class="scale" id="est-quick">
          ${[30, 60, 120, 240, 480].map(v =>
            `<button type="button" data-est="${v}">${v < 60 ? v + 'm' : v / 60 + 'h'}</button>`
          ).join('')}
        </div>
      </div>
      </div>
      <div class="field">
        <label>难度 <span class="hint">1 轻松 → 5 烧脑</span></label>
        <div class="scale diff" id="f-diff">
          ${[1, 2, 3, 4, 5].map(v => `<button type="button" data-v="${v}" class="${t.difficulty === v ? 'on' : ''}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>重要度 <span class="hint">影响排程先后</span></label>
        <div class="scale imp" id="f-imp">
          ${[1, 2, 3, 4, 5].map(v => `<button type="button" data-v="${v}" class="${t.importance === v ? 'on' : ''}">${v}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>重复 <span class="hint">每周固定要做的事会自动排进每一天</span></label>
        <div class="scale repeat" id="f-repeat">
          ${[['none', '不重复'], ['daily', '每天'], ['weekday', '工作日'], ['weekly', '每周'], ['monthly', '每月']]
            .map(([v, label]) => {
              const cur = t.repeat ? (t.repeat.freq === 'weekly' ? 'weekly' : t.repeat.freq) : 'none';
              return `<button type="button" data-freq="${v}" class="${cur === v ? 'on' : ''}">${label}</button>`;
            }).join('')}
        </div>
        <div id="f-weekday-wrap" class="weekday-picker ${t.repeat && t.repeat.freq === 'weekly' ? '' : 'hidden'}">
          ${['日', '一', '二', '三', '四', '五', '六'].map((w, i) => {
            const sel = t.repeat && t.repeat.freq === 'weekly' && t.repeat.weekday === i;
            return `<button type="button" data-wd="${i}" class="${sel ? 'on' : ''}">${w}</button>`;
          }).join('')}
        </div>
        <div id="f-monthday-wrap" class="weekday-picker ${t.repeat && t.repeat.freq === 'monthly' ? '' : 'hidden'}">
          ${Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
            const sel = t.repeat && t.repeat.freq === 'monthly' && t.repeat.monthDay === d;
            return `<button type="button" data-md="${d}" class="${sel ? 'on' : ''}">${d}</button>`;
          }).join('')}
        </div>
        <div id="f-repeat-until" class="repeat-until ${t.repeat ? '' : 'hidden'}">
          <label style="font-size:11.5px;color:var(--ink-3);display:block;margin:8px 0 5px">重复到哪天为止</label>
          <input class="input" type="date" id="f-until" value="${t.repeat && t.repeat.until ? t.repeat.until : ''}"
            style="padding:8px 10px;font-size:13px">
          <div class="hint" style="font-size:11px;color:var(--ink-3);margin-top:5px">
            留空 = 一直重复（最多为你排到 90 天后）
          </div>
        </div>
      </div>

      <div class="field">
        <label>指定时间段 <span class="hint">填了就锁定在这个时间，不再自动挪动</span></label>
        <div class="row2">
          <div>
            <input class="input" type="time" id="f-fixed-start" value="${t.fixedStart || ''}"
              style="padding:9px 10px;font-size:13px">
          </div>
          <div>
            <input class="input" type="time" id="f-fixed-end" value="${t.fixedEnd || ''}"
              style="padding:9px 10px;font-size:13px">
          </div>
        </div>
        <div class="hint" style="font-size:11px;color:var(--ink-3);margin-top:5px">
          两个都不填 = 由系统按优先级自动排时间
        </div>
      </div>

      <div class="field">
        <label>备注 <span class="hint">可选</span></label>
        <textarea class="textarea" id="f-note" rows="2" placeholder="补充说明、资料链接…">${esc(t.note || '')}</textarea>
      </div>
    `,
    foot: `
      ${isNew ? '<button class="btn ghost" data-act="add-with-split">拆成小任务</button>' : ''}
      <button class="btn primary" data-act="save-task" data-id="${t.id}">${isNew ? '添加' : '保存'}</button>
    `,
    onMount() {
      const quick = $('#quick');
      const preview = $('#preview');
      let parsed = null;

      if (quick) {
        const doParse = () => {
          const text = quick.value.trim();
          if (!text) { preview.classList.remove('show'); parsed = null; return; }
          parsed = C.parseInput(text, C.todayISO());
          $('#f-title').value = parsed.title;
          $('#f-due').value = parsed.due || '';
          $('#f-due-time').value = parsed.dueTime || '';
          $('#f-est').value = parsed.estimate;
          setScale('#f-diff', parsed.difficulty);
          setScale('#f-imp', parsed.importance);
          const tags = [];
          if (parsed.due) {
            const dd = C.parseISO(parsed.due);
            tags.push('📅 ' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日' + (parsed.dueTime ? ' ' + parsed.dueTime : ''));
          }
          if (parsed.parsed.duration) tags.push('⏱ ' + C.fmtDuration(parsed.estimate));
          if (parsed.parsed.difficulty) tags.push('🔥 难度 ' + parsed.difficulty);
          if (parsed.parsed.importance) tags.push('⭐ 重要 ' + parsed.importance);
          preview.innerHTML = `识别到：<b>${esc(parsed.title)}</b><br>${tags.length ? tags.map(x => `<span class="tag">${esc(x)}</span>`).join('') : '<span class="muted">没识别到日期，默认今天</span>'}`;
          preview.classList.add('show');
        };
        quick.addEventListener('input', doParse);
        setTimeout(() => quick.focus(), 360);
      }

      $$('#f-diff button').forEach(b => b.addEventListener('click', () => setScale('#f-diff', +b.dataset.v)));
      $$('#f-imp button').forEach(b => b.addEventListener('click', () => setScale('#f-imp', +b.dataset.v)));
      $$('#est-quick button').forEach(b => b.addEventListener('click', () => { $('#f-est').value = +b.dataset.est; }));

      // —— 重复规则 ——
      const wdWrap = $('#f-weekday-wrap');
      const mdWrap = $('#f-monthday-wrap');
      const untilWrap = $('#f-repeat-until');

      const syncRepeatUI = () => {
        const on = $('#f-repeat button.on');
        const freq = on ? on.dataset.freq : 'none';
        wdWrap.classList.toggle('hidden', freq !== 'weekly');
        mdWrap.classList.toggle('hidden', freq !== 'monthly');
        untilWrap.classList.toggle('hidden', freq === 'none');
        // 选「每周」但没指定星期 → 默认取截止日那天的星期
        if (freq === 'weekly' && !$('#f-weekday-wrap button.on')) {
          const due = $('#f-due').value || C.todayISO();
          const wd = C.parseISO(due).getDay();
          $$('#f-weekday-wrap button').forEach(b => b.classList.toggle('on', +b.dataset.wd === wd));
        }
        if (freq === 'monthly' && !$('#f-monthday-wrap button.on')) {
          const due = $('#f-due').value || C.todayISO();
          const md = C.parseISO(due).getDate();
          $$('#f-monthday-wrap button').forEach(b => b.classList.toggle('on', +b.dataset.md === md));
        }
      };

      $$('#f-repeat button').forEach(b => b.addEventListener('click', () => {
        $$('#f-repeat button').forEach(x => x.classList.toggle('on', x === b));
        syncRepeatUI();
      }));
      $$('#f-weekday-wrap button').forEach(b => b.addEventListener('click', () => {
        $$('#f-weekday-wrap button').forEach(x => x.classList.toggle('on', x === b));
      }));
      $$('#f-monthday-wrap button').forEach(b => b.addEventListener('click', () => {
        $$('#f-monthday-wrap button').forEach(x => x.classList.toggle('on', x === b));
      }));

      // —— 指定时间段：自动算出工时 ——
      const fsEl = $('#f-fixed-start');
      const feEl = $('#f-fixed-end');
      const syncFixed = () => {
        const a = fsEl.value, b = feEl.value;
        if (a && b) {
          const span = C.minutesOf(b) - C.minutesOf(a);
          if (span > 0) $('#f-est').value = span;
          else feEl.value = C.clockOf(C.minutesOf(a) + 60);
        }
      };
      if (fsEl) fsEl.addEventListener('change', () => {
        if (fsEl.value && !feEl.value) feEl.value = C.clockOf(C.minutesOf(fsEl.value) + 60);
        syncFixed();
      });
      if (feEl) feEl.addEventListener('change', syncFixed);

      syncRepeatUI();

      if (isNew && !editing) {
        const today = C.todayISO();
        $$('#f-due, #f-due-time').forEach(el => el.addEventListener('change', () => {
          if (!$('#f-due').value) $('#f-due').value = today;
        }));
      }
    }
  });
}

function setScale(sel, v) {
  $$(sel + ' button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
}

function readEditor() {
  const curDiff = $('#f-diff button.on');
  const curImp = $('#f-imp button.on');

  // —— 重复规则 ——
  const freqBtn = $('#f-repeat button.on');
  const freq = freqBtn ? freqBtn.dataset.freq : 'none';
  let repeat = null;
  if (freq !== 'none') {
    repeat = { freq: freq, until: ($('#f-until') || {}).value || null };
    if (freq === 'weekly') {
      const wd = $('#f-weekday-wrap button.on');
      repeat.weekday = wd ? +wd.dataset.wd : C.parseISO(($('#f-due') || {}).value || C.todayISO()).getDay();
    }
    if (freq === 'monthly') {
      const md = $('#f-monthday-wrap button.on');
      repeat.monthDay = md ? +md.dataset.md : C.parseISO(($('#f-due') || {}).value || C.todayISO()).getDate();
    }
  }

  // —— 指定时间段 ——
  const a = ($('#f-fixed-start') || {}).value || '';
  const b = ($('#f-fixed-end') || {}).value || '';
  const fixedStart = (a && b) ? a : null;
  const fixedEnd = (a && b) ? b : null;

  return {
    title: ($('#f-title') ? $('#f-title').value : '').trim() || '未命名任务',
    due: $('#f-due').value || null,
    dueTime: $('#f-due-time').value || null,
    estimate: Math.max(0, parseInt($('#f-est').value, 10) || 0),
    difficulty: curDiff ? +curDiff.dataset.v : 3,
    importance: curImp ? +curImp.dataset.v : 3,
    note: ($('#f-note') ? $('#f-note').value : '').trim(),
    repeat: repeat,
    fixedStart: fixedStart,
    fixedEnd: fixedEnd
  };
}

function saveTask(taskId, withSplit) {
  const data = readEditor();
  let task = taskId ? taskById(taskId) : null;
  const hadRepeat = !!(task && task.repeat);

  if (task) {
    Object.assign(task, data);
    if (task.subtasks.length && data.estimate && C.totalEstimate(task) !== data.estimate) {
      // 子任务存在时，按比例缩放保持与总工时一致
      const cur = C.totalEstimate(task) || 1;
      const k = data.estimate / cur;
      task.subtasks.forEach(s => { s.estimate = Math.max(5, Math.round(s.estimate * k)); });
    }
    // 重新规范化重复/时段字段
    const norm = C.normalizeTask(task);
    Object.assign(task, norm);
  } else {
    const dueISO = data.due || C.todayISO();
    task = C.normalizeTask(Object.assign({}, data, { due: dueISO }));

    // 重复任务：把「今天起的一个系列」直接铺进任务列表，
    // 这样日历、今天页、未来排程都能直接看到每一次
    if (data.repeat) {
      const instances = C.materializeRepeat(task, C.todayISO(), { horizonDays: 90, maxCount: 60 });
      if (instances.length) {
        task.seriesId = instances[0].seriesId;
        S.tasks.unshift(...instances);
        save();
        closeSheet();
        vibrate([10, 30, 20]);
        toast(`已添加，${C.repeatLabel(data.repeat)}，共排入 ${instances.length} 次`);
        render();
        return;
      }
    }
    S.tasks.unshift(task);
  }

  save();
  closeSheet();
  vibrate(10);
  toast(taskId ? '已保存' : '已添加，已按优先级排序');

  if (withSplit) {
    setTimeout(() => openBreakdown(task.id, true), 240);
  } else {
    render();
    // 大任务提示
    if (!taskId && C.remainingMinutes(task) >= 180 && !task.subtasks.length) {
      setTimeout(() => {
        toast('这是个 ' + C.fmtDuration(C.remainingMinutes(task)) + ' 的大任务，试试智能拆解？');
      }, 900);
    }
  }
}

/* ---------------------------------------------------------------- 智能拆解 */
function openBreakdown(taskId, autoApply) {
  const t = taskById(taskId);
  if (!t) return;
  let result = C.breakdown(t, C.todayISO());
  const existing = t.subtasks.length ? t.subtasks : null;
  let items = existing ? existing.map(s => Object.assign({}, s)) : result.subtasks.map(s => Object.assign({}, s));

  function body() {
    const total = items.reduce((a, s) => a + (s.estimate || 0), 0);
    return `
      <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 22%, transparent)">
        ${icon('spark')}
        <div>识别为「<b>${esc(result.domainLabel)}</b>」类任务，共 <b>${items.length}</b> 步、合计 <b>${C.fmtDuration(total)}</b>。
        可直接改标题和工时，删掉不需要的步骤。</div>
      </div>
      <div class="step-list" id="steps">
        ${items.map((s, i) => `
          <div class="step" data-i="${i}">
            <div class="num">${i + 1}</div>
            <div class="sc">
              <input class="step-title" data-i="${i}" value="${esc(s.title)}"
                style="border:none;background:none;padding:0;font-size:13.5px;font-weight:600;width:100%;outline:none;color:var(--ink)">
              <span>${s.suggestedDate ? '建议 ' + (C.parseISO(s.suggestedDate).getMonth() + 1) + '/' + C.parseISO(s.suggestedDate).getDate() + ' 前完成' : '未定日期'}
                <span class="phase-tag">${s.phase || '推进'}</span></span>
            </div>
            <input class="step-est" type="number" min="5" step="5" data-i="${i}" value="${s.estimate}"
              style="width:56px;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:4px 6px;
              font-size:12px;text-align:center;font-variant-numeric:tabular-nums;flex:none">
            <button class="del" data-del="${i}" style="color:var(--ink-3);align-self:center">${icon('close')}</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn sm ghost" data-act="split-regenerate">重新生成</button>
        <button class="btn sm ghost" data-act="split-add">＋ 加一步</button>
        <div style="flex:1"></div>
        <span class="muted" style="font-size:11.5px;align-self:center">合计 ${C.fmtDuration(total)}</span>
      </div>
    `;
  }

  openSheet({
    title: '智能拆解：' + C.shortTitle(t.title, 10),
    body: body(),
    foot: `
      <button class="btn ghost" data-act="split-cancel">取消</button>
      <button class="btn primary" data-act="split-apply" data-id="${t.id}">应用 ${items.length} 个子任务</button>
    `,
    onMount(sheet) {
      const bind = () => {
        $$('.step-title', sheet).forEach(inp => {
          inp.addEventListener('input', () => { items[+inp.dataset.i].title = inp.value; });
        });
        $$('.step-est', sheet).forEach(inp => {
          inp.addEventListener('input', () => { items[+inp.dataset.i].estimate = Math.max(0, +inp.value || 0); });
        });
        $$('.del', sheet).forEach(btn => {
          if (btn.dataset.del === undefined) return;
          btn.addEventListener('click', () => {
            items.splice(+btn.dataset.del, 1);
            updateSheetBody(body(), true);
          });
        });
      };
      bind();
      sheet.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'split-regenerate') {
          result = C.breakdown(t, C.todayISO());
          items = result.subtasks.map(s => Object.assign({}, s));
          updateSheetBody(body(), true);
        } else if (act === 'split-add') {
          items.push({
            id: C.uid(), title: '新的步骤', estimate: 30, done: false,
            doneAt: null, suggestedDate: t.due, phase: '推进'
          });
          updateSheetBody(body(), true);
        } else if (act === 'split-cancel') {
          closeSheet();
        } else if (act === 'split-apply') {
          applySplit(t.id, items);
        }
      });
    }
  });
}

function applySplit(taskId, items) {
  const t = taskById(taskId);
  if (!t) return;
  const keepDone = {};
  t.subtasks.forEach(s => { keepDone[s.title] = s.done; });
  t.subtasks = items.filter(s => s.title && s.title.trim()).map(s => ({
    id: s.id || C.uid(),
    title: s.title.trim(),
    estimate: Math.max(5, Math.round(s.estimate || 15)),
    done: s.done || !!keepDone[s.title] || false,
    doneAt: s.doneAt || null,
    suggestedDate: s.suggestedDate || null,
    phase: s.phase || '推进'
  }));
  t.estimate = t.subtasks.reduce((a, s) => a + s.estimate, 0);
  save();
  closeSheet();
  vibrate(14);
  toast(`已拆成 ${t.subtasks.length} 步，排程已更新`);
  render();
}

/* ---------------------------------------------------------------- 任务详情 */
function openTaskDetail(taskId, keepOpen) {
  const t = taskById(taskId);
  if (!t) return;
  currentDetailId = t.id;
  const today = C.todayISO();
  const sc = C.scoreOf(t, today);
  const prog = C.progressOf(t);
  if (keepOpen && $('.sheet') && $('.sheet-body')) {
    updateSheetBody(body(), true);
    return;
  }

  function body() {
    return `
      <div class="detail-hero">
        <textarea class="detail-title" id="d-title" rows="1">${esc(t.title)}</textarea>
        <div class="detail-meta">
          <span class="pill ${sc.score >= 75 ? 'hot' : ''}">优先级 ${sc.score} 分</span>
          <span class="pill">${icon('clock')}${esc(C.dueLabel(t, today))}</span>
          <span class="pill amber">难度 ${t.difficulty}</span>
          <span class="pill amber">重要 ${t.importance}</span>
          <span class="pill jade">剩 ${C.fmtDuration(C.remainingMinutes(t))}</span>
        </div>
      </div>

      <div class="score-card">
        <div class="score-num">${sc.score}<small>分</small></div>
        <div class="score-info">
          <div class="t">${sc.daysLeft === null ? '没有截止日期' : sc.daysLeft < 0 ? '已逾期 ' + Math.abs(sc.daysLeft) + ' 天' : sc.daysLeft === 0 ? '今天截止' : '还有 ' + sc.daysLeft + ' 天'}</div>
          <div class="r">${sc.reasons.join(' · ')}</div>
        </div>
      </div>

      ${t.subtasks.length ? `
        <div class="detail-section-title">
          <span>子任务 · ${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>
          <button class="link" data-act="detail-split" style="font-size:12px">重新拆解</button>
        </div>
        <div class="sub-list">
          ${t.subtasks.map((s, i) => `
            <div class="sub-item ${s.done ? 'done' : ''}" data-sub="${s.id}">
              <button class="check ${s.done ? 'on' : ''}" data-act="toggle-sub" data-id="${t.id}" data-sub="${s.id}">${icon('check')}</button>
              <div class="st">
                <b>${esc(s.title)}</b>
                <span>${C.fmtDuration(s.estimate)}${s.suggestedDate ? ' · 建议 ' + (C.parseISO(s.suggestedDate).getMonth() + 1) + '/' + C.parseISO(s.suggestedDate).getDate() : ''}</span>
              </div>
              <button class="del" data-act="del-sub" data-id="${t.id}" data-sub="${s.id}">${icon('close')}</button>
            </div>`).join('')}
        </div>
        <div class="t-prog" style="margin-top:12px"><div class="bar"><i style="width:${prog}%;background:var(--jade)"></i></div><span>${prog}%</span></div>
      ` : (C.remainingMinutes(t) >= 180 ? `
        <div class="notice" style="margin-top:4px">
          ${icon('spark')}
          <div>这是个 ${C.fmtDuration(C.remainingMinutes(t))} 的大任务，建议先拆成小步骤，再来安排时间。</div>
        </div>` : '')}

      <div class="detail-section-title"><span>调整</span></div>
      <div class="card" style="padding:12px 14px;background:var(--paper);box-shadow:none;border:1px solid var(--line-soft)">
        <div class="row2" style="gap:12px">
          <div>
            <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">截止日期</label>
            <input class="input" type="date" id="d-due" value="${t.due || ''}" style="padding:8px 10px;font-size:13px">
          </div>
          <div style="margin-top:10px">
            <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">截止时间</label>
            <input class="input" type="time" id="d-time" value="${t.dueTime || ''}" style="padding:8px 10px;font-size:13px">
          </div>
        </div>
        <div style="margin-top:12px">
          <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">
            难度 <b id="d-diff-v" style="color:var(--ink)">${t.difficulty}</b>
          </label>
          <div class="scale diff" id="d-diff">
            ${[1, 2, 3, 4, 5].map(v => `<button data-v="${v}" class="${t.difficulty === v ? 'on' : ''}">${v}</button>`).join('')}
          </div>
        </div>
        <div style="margin-top:10px">
          <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">
            重要度 <b id="d-imp-v" style="color:var(--ink)">${t.importance}</b>
          </label>
          <div class="scale imp" id="d-imp">
            ${[1, 2, 3, 4, 5].map(v => `<button data-v="${v}" class="${t.importance === v ? 'on' : ''}">${v}</button>`).join('')}
          </div>
        </div>
        <div style="margin-top:12px">
          <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">
            预计工时（分钟）${t.subtasks.length ? ' · 由子任务合计' : ''}
          </label>
          <input class="input" type="number" id="d-est" min="5" step="5"
            value="${t.subtasks.length ? C.totalEstimate(t) : t.estimate}" ${t.subtasks.length ? 'disabled' : ''}
            style="padding:8px 10px;font-size:13px">
        </div>
        <div style="margin-top:12px">
          <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:5px">备注</label>
          <textarea class="textarea" id="d-note" rows="2" style="font-size:13px;padding:8px 10px;min-height:56px">${esc(t.note || '')}</textarea>
        </div>
      </div>

      <div class="detail-section-title"><span>操作</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn grow" data-act="detail-focus" data-id="${t.id}">${icon('play')}开始专注</button>
        <button class="btn grow" data-act="detail-split">${icon('spark')}智能拆解</button>
      </div>
    `;
  }

  openSheet({
    title: '任务详情',
    body: body(),
    foot: `
      <button class="btn danger" data-act="delete-task" data-id="${t.id}">${icon('trash')}</button>
      <button class="btn primary" data-act="save-detail" data-id="${t.id}">保存</button>
    `,
    onMount(sheet) {
      const ta = $('#d-title', sheet);
      if (ta) {
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        grow();
        ta.addEventListener('input', grow);
      }
      $$('#d-diff button', sheet).forEach(b => b.addEventListener('click', () => {
        setScale('#d-diff', +b.dataset.v);
        $('#d-diff-v').textContent = b.dataset.v;
      }));
      $$('#d-imp button', sheet).forEach(b => b.addEventListener('click', () => {
        setScale('#d-imp', +b.dataset.v);
        $('#d-imp-v').textContent = b.dataset.v;
      }));
    }
  });
}

function saveDetail(taskId) {
  const t = taskById(taskId);
  if (!t) return;
  t.title = ($('#d-title') ? $('#d-title').value : t.title).trim() || '未命名任务';
  t.due = ($('#d-due').value || null);
  t.dueTime = ($('#d-time').value || null);
  t.difficulty = +(($('#d-diff button.on') || { dataset: { v: t.difficulty } }).dataset.v);
  t.importance = +(($('#d-imp button.on') || { dataset: { v: t.importance } }).dataset.v);
  if (!$('#d-est').disabled) t.estimate = Math.max(0, +$('#d-est').value || 0);
  t.note = ($('#d-note').value || '').trim();
  save();
  closeSheet();
  toast('已保存');
  render();
}

/* ---------------------------------------------------------------- 固定安排 */
function openEventEditor(presetDate) {
  openSheet({
    title: '添加固定安排',
    body: `
      <div class="notice">${icon('clock')}<div>上课、通勤、开会这类不可移动的时间，加进来后自动排程会绕开它。</div></div>
      <div class="field"><label>名称</label>
        <input class="input" id="e-title" placeholder="例：高等数学课"></div>
      <div class="field"><label>日期</label>
        <input class="input" type="date" id="e-date" value="${presetDate || C.todayISO()}"></div>
      <div class="row2">
        <div class="field"><label>开始</label><input class="input" type="time" id="e-start" value="09:00"></div>
        <div class="field"><label>结束</label><input class="input" type="time" id="e-end" value="10:30"></div>
      </div>
    `,
    foot: `<button class="btn ghost" data-act="sheet-close">取消</button>
           <button class="btn primary" data-act="save-event">添加</button>`,
    onMount(sheet) {
      setTimeout(() => { const el = $('#e-title', sheet); if (el) el.focus(); }, 320);
    }
  });
}

function saveEvent() {
  const title = ($('#e-title').value || '').trim();
  if (!title) { toast('给安排起个名字'); return; }
  const date = $('#e-date').value || C.todayISO();
  const start = $('#e-start').value || '09:00';
  let end = $('#e-end').value || '10:00';
  if (C.minutesOf(end) <= C.minutesOf(start)) {
    end = C.clockOf(C.minutesOf(start) + 60);
  }
  S.events.push({ id: C.uid(), title, date, start, end });
  save();
  closeSheet();
  toast('已添加固定安排');
  render();
}

/* ---------------------------------------------------------------- 未来排程概览 */
function openPlanWeek() {
  const today = C.todayISO();
  const plans = C.planRange({
    startISO: today, days: 7, tasks: S.tasks, events: S.events,
    settings: S.settings, nowISO: today, nowMin: C.currentMin()
  });
  const days = plans.map(p => ({ iso: p.date, plan: p }));
  const totalMin = days.reduce((a, x) => a + x.plan.stats.scheduled, 0);
  const maxLoad = Math.max.apply(null, days.map(d => d.plan.stats.scheduled).concat([1]));
  const backlog = plans[0].stats.backlog;
  const left = Math.max(0, backlog - totalMin);

  openSheet({
    title: '未来 7 天怎么排',
    body: `
      <div class="notice" style="background:var(--sky-soft);border-color:color-mix(in srgb,var(--sky) 22%,transparent)">
        ${icon('spark')}
        <div>按当前优先级把 <b>${C.fmtHours(backlog)}</b> 的待办摊到 7 天里，这周计划投入 <b>${C.fmtHours(totalMin)}</b>${
          left > 0 ? `，还剩 <b>${C.fmtHours(left)}</b> 会继续往后排` : '，能全部覆盖'
        }。</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        ${days.map(({ iso, plan }) => {
          const d = C.parseISO(iso);
          const h = plan.stats.scheduled;
          const ratio = Math.round(h / maxLoad * 100);
          const isToday = iso === today;
          const warn = plan.unscheduled.length > 0;
          return `<div style="padding:11px 12px;border-radius:12px;background:var(--paper)">
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
              <b style="font-size:13.5px">${isToday ? '今天' : C.weekdayOf(iso)}</b>
              <span class="muted" style="font-size:11.5px">${d.getMonth() + 1}/${d.getDate()}</span>
              <div style="flex:1"></div>
              <span style="font-size:12px;font-weight:650;color:${warn ? 'var(--accent)' : 'var(--ink-2)'}">${h ? C.fmtHours(h) : '自由'}</span>
            </div>
            <div class="bar"><i style="width:${Math.max(h ? 4 : 0, ratio)}%;background:${warn ? 'var(--accent)' : 'var(--jade)'}"></i></div>
            ${warn ? `<div style="font-size:11px;color:var(--accent);margin-top:6px">还有 ${C.fmtDuration(plan.unscheduled.reduce((a, x) => a + x.minutes, 0))} 没排进去</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `,
    foot: `<button class="btn ghost" data-act="sheet-close">关闭</button>
           <button class="btn primary" data-act="export-ics">导出到日历</button>`
  });
}

/* ---------------------------------------------------------------- 快速示例 */
function seedDemo() {
  const today = C.todayISO();
  const mk = (title, dueOffset, opts) => {
    const t = C.normalizeTask(Object.assign({
      title, due: dueOffset === null ? null : C.addDaysISO(today, dueOffset)
    }, opts || {}));
    S.tasks.push(t);
    return t;
  };
  mk('完成毕业论文初稿', 21, {
    estimate: 0, difficulty: 5, importance: 5,
    note: '导师要求先交框架和文献综述'
  });
  const thesis = S.tasks[0];
  const bd = C.breakdown(thesis, today);
  thesis.subtasks = bd.subtasks;
  thesis.estimate = bd.total;

  mk('小程序需求文档', 2, { estimate: 90, difficulty: 3, importance: 4, note: '列清功能清单和验收标准' });
  mk('高数作业第三章', 0, { dueTime: '22:00', estimate: 60, difficulty: 4, importance: 4 });
  mk('给导师发进度邮件', 1, { estimate: 20, difficulty: 1, importance: 3 });
  mk('健身房 · 力量训练', 0, { dueTime: '19:30', estimate: 60, difficulty: 2, importance: 2 });
  const done1 = mk('回复实验课数据问题', -1, { estimate: 30, difficulty: 2, importance: 3 });
  done1.done = true; done1.doneAt = C.addDaysISO(today, -1);
  mk('整理实习投递清单', 5, { estimate: 120, difficulty: 3, importance: 4 });

  S.events.push({ id: C.uid(), title: '高等数学课', date: today, start: '08:00', end: '09:40' });
  S.events.push({ id: C.uid(), title: '产品组会', date: C.addDaysISO(today, 1), start: '14:00', end: '15:00' });
  S.seeded = true;
  save();
}

/* ---------------------------------------------------------------- 主渲染 */
function render() {
  renderTopbar();
  renderTabbar();
  const view = $('#view');
  view.classList.toggle('no-tab', false);
  view.scrollTop = 0;
  if (S.view === 'today') renderToday(view);
  else if (S.view === 'calendar') renderCalendar(view);
  else if (S.view === 'tasks') renderTasks(view);
  else if (S.view === 'settings') renderSettings(view);
}
