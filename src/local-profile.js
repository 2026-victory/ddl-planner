/* ==========================================================================
 * local-profile.js —— 本机多用户档案（纯离线，不联网）
 *
 * 作用：让「登录账号就能看到自己的任务」这个体验保留下来，
 *       但所有数据只存在这台设备的浏览器存储里，不发往任何服务器。
 *
 * 设计：
 *   - 每个档案独立一份数据（任务、固定安排、设置）
 *   - 记住上次使用的档案，下次打开直接进入
 *   - 支持切换档案、改名、删除
 * ========================================================================== */
'use strict';

const PROFILE_KEY = 'ddl-profiles-v1';
const ACTIVATE_KEY = 'ddl-active-profile';

/** 档案表：{ id: {id, name, createdAt, updatedAt} } */
let Profiles = {};
let activeProfileId = '';

/* ---------------- 读写档案表 ---------------- */
function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    Profiles = raw ? JSON.parse(raw) : {};
    if (typeof Profiles !== 'object' || !Profiles) Profiles = {};
  } catch (e) {
    Profiles = {};
  }
  try {
    activeProfileId = localStorage.getItem(ACTIVATE_KEY) || '';
  } catch (e) {
    activeProfileId = '';
  }

  // 一个档案都没有 → 建一个默认的
  if (Object.keys(Profiles).length === 0) {
    const p = createProfile('我的任务', true);
    activeProfileId = p.id;
  }
  // 记录的档案不存在了 → 回退到第一个
  if (!Profiles[activeProfileId]) {
    activeProfileId = Object.keys(Profiles)[0];
  }
  saveProfiles();
  return Profiles;
}

function saveProfiles() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(Profiles));
    localStorage.setItem(ACTIVATE_KEY, activeProfileId);
  } catch (e) {
    console.warn('档案保存失败', e);
  }
}

/* ---------------- 档案增删改 ---------------- */
function createProfile(name, silent) {
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  Profiles[id] = { id, name: String(name || '新档案').trim() || '新档案', createdAt: now, updatedAt: now };
  if (!silent) saveProfiles();
  return Profiles[id];
}

function renameProfile(id, name) {
  if (!Profiles[id]) return false;
  const n = String(name || '').trim();
  if (!n) return false;
  Profiles[id].name = n.slice(0, 24);
  Profiles[id].updatedAt = new Date().toISOString();
  saveProfiles();
  return true;
}

function deleteProfile(id) {
  if (!Profiles[id]) return false;
  // 至少保留一个档案，否则用户会丢光所有数据
  if (Object.keys(Profiles).length <= 1) return false;

  // 删除该档案的数据
  try { localStorage.removeItem(dataKey(id)); } catch (e) {}

  delete Profiles[id];
  if (activeProfileId === id) {
    activeProfileId = Object.keys(Profiles)[0];
  }
  saveProfiles();
  return true;
}

/** 每个档案一个独立存储键 */
function dataKey(profileId) {
  return 'ddl-data-' + profileId;
}

function currentProfile() {
  return Profiles[activeProfileId] || null;
}

/* ---------------- 档案切换 ---------------- */
/**
 * 切到另一个档案：
 *   1. 先把当前数据存进当前档案
 *   2. 再读出目标档案的数据
 */
function switchProfile(id) {
  if (!Profiles[id] || id === activeProfileId) return false;

  // 保存当前
  try { persistCurrent(); } catch (e) {}

  const prev = activeProfileId;
  activeProfileId = id;
  saveProfiles();

  // 载入目标
  try { loadProfileData(id); } catch (e) { console.warn(e); }
  return prev !== id;
}

/** 把当前内存里的数据写入「当前档案」的存储键 */
function persistCurrent() {
  if (!activeProfileId) return;
  const payload = JSON.stringify({
    tasks: S.tasks,
    events: S.events,
    settings: S.settings,
    seeded: S.seeded,
    fired: S.fired,
    updatedAt: new Date().toISOString(),
    v: 3
  });
  localStorage.setItem(dataKey(activeProfileId), payload);

  if (Profiles[activeProfileId]) {
    Profiles[activeProfileId].updatedAt = new Date().toISOString();
    saveProfiles();
  }
}

/** 读取某档案的数据到内存；没有则留空 */
function loadProfileData(id) {
  let raw = null;
  try { raw = localStorage.getItem(dataKey(id)); } catch (e) {}

  if (!raw) {
    S.tasks = [];
    S.events = [];
    S.settings = Object.assign({}, C.DEFAULT_SETTINGS);
    S.seeded = false;
    S.fired = {};
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
    console.warn('档案数据损坏', e);
    S.tasks = [];
    S.events = [];
    S.settings = Object.assign({}, C.DEFAULT_SETTINGS);
    S.seeded = false;
    S.fired = {};
    return false;
  }
}

/** 统计某档案有多少任务（用于列表展示） */
function profileStats(id) {
  try {
    const raw = localStorage.getItem(dataKey(id));
    if (!raw) return { tasks: 0, done: 0 };
    const d = JSON.parse(raw);
    const list = d.tasks || [];
    return { tasks: list.length, done: list.filter(t => t.done).length };
  } catch (e) {
    return { tasks: 0, done: 0 };
  }
}

/* ---------------- 与旧版数据的兼容 ---------------- */
/**
 * 早期版本把数据存在全局键里（ddl-planner-v1）。
 * 第一次升级到多档案时，把这份数据搬进默认档案，避免用户丢失。
 */
function migrateLegacyData() {
  const LEGACY = 'ddl-planner-v1';
  let raw = null;
  try { raw = localStorage.getItem(LEGACY); } catch (e) {}
  if (!raw) return false;

  const target = dataKey(activeProfileId);
  // 目标档案已经有数据 → 不覆盖
  try {
    if (localStorage.getItem(target)) return false;
  } catch (e) {}

  try {
    localStorage.setItem(target, raw);
    // 保留旧键作为自动备份，不删除（用户还能「找回上次数据」）
    localStorage.setItem('ddl-migrated-at', new Date().toISOString());
    return true;
  } catch (e) {
    return false;
  }
}
