/* ==========================================================================
 * profile-ui.js —— 本机档案界面（替代原来的云端登录）
 *   保留「登录账号后看到自己的数据」这个体验，但完全离线。
 * ========================================================================== */
'use strict';

function openProfileSheet() {
  const list = Object.keys(Profiles).map(id => Profiles[id]);
  const active = activeProfileId;

  openSheet({
    title: '本机档案',
    body: `
      <div class="notice" style="background:var(--jade-soft);border-color:color-mix(in srgb,var(--jade) 24%,transparent)">
        ${icon('check')}
        <div>数据全部保存在<b>这台设备</b>，不需要网络、不需要注册、不会上传到任何服务器。</div>
      </div>

      <div class="detail-section-title" style="margin-top:16px">
        <span>选择档案</span>
        <span class="muted" style="font-size:11.5px;font-weight:400">切换后看到对应档案的数据</span>
      </div>

      <div class="profile-list">
        ${list.map(p => {
          const st = profileStats(p.id);
          const isActive = p.id === active;
          return `
            <div class="profile-item ${isActive ? 'on' : ''}" data-profile="${p.id}">
              <button class="profile-main" data-act="switch-profile" data-id="${p.id}">
                <span class="pf-avatar">${esc(p.name.slice(0, 1))}</span>
                <span class="pf-body">
                  <b>${esc(p.name)}${isActive ? '<span class="pf-badge">当前</span>' : ''}</b>
                  <span>${st.tasks} 个任务 · 已完成 ${st.done}</span>
                </span>
                ${isActive ? `<span class="pf-check">${icon('check')}</span>` : ''}
              </button>
              <button class="pf-more" data-act="profile-menu" data-id="${p.id}" aria-label="更多">
                ${icon('chev')}
              </button>
            </div>`;
        }).join('')}
      </div>

      <button class="btn ghost" style="width:100%;margin-top:14px" data-act="new-profile">
        ${icon('plus')} 新建档案
      </button>

      <div class="notice" style="margin-top:14px">
        ${icon('flag')}
        <div>多个档案适合区分<b>不同场景</b>（比如「工作」「学习」），
        每个档案的任务、日历、设置都是独立的。</div>
      </div>
    `,
    foot: `<button class="btn primary" data-act="sheet-close">关闭</button>`
  });
}

/** 单个档案的更多操作 */
function openProfileMenu(id) {
  const p = Profiles[id];
  if (!p) return;
  const isActive = id === activeProfileId;
  const canDelete = Object.keys(Profiles).length > 1;

  openSheet({
    title: p.name,
    body: `
      <div class="card" style="padding:14px;background:var(--paper);box-shadow:none;border:1px solid var(--line-soft)">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0">
          <span class="muted">任务数量</span><b>${profileStats(id).tasks} 个</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0">
          <span class="muted">创建时间</span><b>${formatDate(p.createdAt)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0">
          <span class="muted">最近修改</span><b>${formatDate(p.updatedAt)}</b>
        </div>
      </div>

      <div class="field" style="margin-top:16px">
        <label>重命名</label>
        <input class="input" id="pf-name" value="${esc(p.name)}" maxlength="24" placeholder="给档案起个名字">
      </div>
      <button class="btn primary" style="width:100%" data-act="save-profile-name" data-id="${id}">保存名称</button>

      <div style="display:flex;gap:8px;margin-top:10px">
        ${isActive ? '' : `<button class="btn grow" data-act="switch-profile" data-id="${id}">切换到该档案</button>`}
        <button class="btn grow" data-act="export-profile" data-id="${id}">导出这份数据</button>
      </div>

      ${canDelete ? `
        <button class="btn danger" style="width:100%;margin-top:10px" data-act="delete-profile" data-id="${id}">
          ${icon('trash')} 删除这个档案
        </button>
        <div class="hint" style="font-size:11px;color:var(--ink-3);margin-top:6px;text-align:center">
          删除后该档案的任务无法恢复，建议先导出备份
        </div>
      ` : `
        <div class="notice" style="margin-top:14px">
          ${icon('flag')}
          <div>这是唯一的档案，不能删除。你可以先新建一个，再删掉这个。</div>
        </div>
      `}
    `,
    foot: `<button class="btn primary" data-act="open-account">返回列表</button>`,
    onMount(sheet) {
      setTimeout(() => {
        const el = $('#pf-name', sheet);
        if (el) el.focus();
      }, 340);
    }
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch (e) {
    return '—';
  }
}

/* ---------------- 操作 ---------------- */
function doSwitchProfile(id) {
  if (id === activeProfileId) { closeSheet(); return; }
  const p = Profiles[id];
  if (!p) return;

  if (switchProfile(id)) {
    save();
    closeSheet(true);
    render();
    toast('已切换到「' + p.name + '」');
  } else {
    toast('切换失败');
  }
}

function doNewProfile() {
  const name = prompt('给新档案起个名字：', '新档案');
  if (name === null) return;
  const p = createProfile(name);
  if (p) {
    switchProfile(p.id);
    save();
    closeSheet(true);
    render();
    toast('已创建并切换到「' + p.name + '」');
  }
}

function doDeleteProfile(id) {
  const p = Profiles[id];
  if (!p) return;
  if (Object.keys(Profiles).length <= 1) {
    toast('至少要保留一个档案');
    return;
  }
  if (!confirm(`删除档案「${p.name}」？\n\n里面的任务会一起删掉，无法恢复。`)) return;

  if (deleteProfile(id)) {
    loadProfileData(activeProfileId);
    closeSheet(true);
    render();
    toast('已删除');
  } else {
    toast('删除失败');
  }
}

function doExportProfile(id) {
  const key = dataKey(id);
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) {}
  if (!raw) { toast('这个档案还没有数据'); return; }

  const p = Profiles[id];
  download(
    `DDL-${p ? p.name : '档案'}-${C.todayISO()}.json`,
    raw,
    'application/json'
  );
  toast('已导出');
}
