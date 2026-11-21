/*
 * server.js —— 零依赖的账号与同步服务器
 *   - 只用 Node 内置模块，不需要 npm install
 *   - 账号：仅用户名 + 密码（可选），服务端只存哈希
 *   - 数据：每个账号一份 JSON，存本地文件
 *
 * 用法：
 *   node server.js                 # 默认 3000 端口
 *   PORT=8080 node server.js       # 自定义端口
 *   DATA_DIR=./data node server.js # 自定义数据目录
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'server-data');
const PUBLIC_DIR = path.join(__dirname, 'app');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DATA_SUBDIR = path.join(DATA_DIR, 'data');

/* ---------------- 存储 ---------------- */
function ensureDirs() {
  fs.mkdirSync(DATA_SUBDIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', 'utf8');
}
ensureDirs();

let usersCache = null;
function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    usersCache = {};
  }
  return usersCache;
}
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(usersCache, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_FILE);   // 原子替换，避免写一半断电
}

/* ---------------- 密码 ---------------- */
function hashedPassword(pw, salt) {
  return crypto.pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('hex');
}
function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------------- 会话 ---------------- */
const sessions = new Map();   // token -> { username, createdAt }

function issueToken(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

function userFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = sessions.get(m[1].trim());
  return s ? s.username : null;
}

/* ---------------- 用户名规则 ---------------- */
function normalizeName(name) {
  return String(name || '').trim();
}

function validName(name) {
  // 2~24 个字符，允许中英文、数字、下划线、连字符
  return /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,24}$/.test(name);
}

/** 用户名 -> 安全的文件名（避免路径穿越） */
function userFile(username) {
  const h = crypto.createHash('sha256').update(username).digest('hex').slice(0, 32);
  return path.join(DATA_SUBDIR, h + '.json');
}

/* ---------------- 工具 ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limitBytes || 4 * 1024 * 1024)) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- 业务处理 ---------------- */
async function handleApi(req, res, pathname) {
  // 探活
  if (pathname === '/api/health') {
    return json(res, 200, { ok: true, time: new Date().toISOString() });
  }

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizeName(body.username);
    const password = body.password ? String(body.password) : '';

    if (!validName(username)) {
      return json(res, 400, { error: '账号名需为 2~24 位中文、字母、数字、下划线或连字符' });
    }
    if (password && password.length < 4) {
      return json(res, 400, { error: '密码至少 4 位' });
    }

    const users = loadUsers();
    if (users[username]) {
      return json(res, 409, { error: '这个账号名已被使用，换一个吧' });
    }

    const salt = newSalt();
    users[username] = {
      salt,
      hash: password ? hashedPassword(password, salt) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveUsers();

    // 初始化该账号的空间
    const file = userFile(username);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({
        tasks: [], events: [], settings: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rev: 0
      }, null, 2), 'utf8');
    }

    const token = issueToken(username);
    return json(res, 200, { ok: true, token, username, isNew: true });
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizeName(body.username);
    const password = body.password ? String(body.password) : '';
    const users = loadUsers();
    const u = users[username];

    if (!u) return json(res, 404, { error: '账号不存在，请先注册' });

    // 无密码账号：直接进入
    if (u.hash) {
      if (!password) return json(res, 401, { error: '该账号设了密码，请输入' });
      if (!safeEqual(hashedPassword(password, u.salt), u.hash)) {
        return json(res, 401, { error: '密码不正确' });
      }
    }

    u.updatedAt = new Date().toISOString();
    saveUsers();
    const token = issueToken(username);
    return json(res, 200, { ok: true, token, username, hasPassword: !!u.hash });
  }

  // 退出
  if (pathname === '/api/logout' && req.method === 'POST') {
    const auth = req.headers['authorization'] || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) sessions.delete(m[1].trim());
    return json(res, 200, { ok: true });
  }

  // 拉取数据
  if (pathname === '/api/data' && req.method === 'GET') {
    const username = userFromReq(req);
    if (!username) return json(res, 401, { error: '未登录或登录已过期' });

    const file = userFile(username);
    if (!fs.existsSync(file)) {
      return json(res, 200, { tasks: [], events: [], settings: null, rev: 0, empty: true });
    }
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return json(res, 200, {
        tasks: d.tasks || [],
        events: d.events || [],
        settings: d.settings || null,
        rev: d.rev || 0,
        updatedAt: d.updatedAt || null
      });
    } catch (e) {
      return json(res, 500, { error: '云端数据损坏' });
    }
  }

  // 保存数据
  if (pathname === '/api/data' && (req.method === 'PUT' || req.method === 'POST')) {
    const username = userFromReq(req);
    if (!username) return json(res, 401, { error: '未登录或登录已过期' });

    const body = await readBody(req);
    if (!Array.isArray(body.tasks)) {
      return json(res, 400, { error: 'tasks 必须是数组' });
    }

    const file = userFile(username);
    let prevRev = 0;
    if (fs.existsSync(file)) {
      try { prevRev = JSON.parse(fs.readFileSync(file, 'utf8')).rev || 0; } catch (e) {}
    }

    const payload = {
      tasks: body.tasks,
      events: Array.isArray(body.events) ? body.events : [],
      settings: body.settings || null,
      rev: prevRev + 1,
      updatedAt: new Date().toISOString()
    };

    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file);

    const users = loadUsers();
    if (users[username]) {
      users[username].updatedAt = payload.updatedAt;
      saveUsers();
    }

    return json(res, 200, { ok: true, rev: payload.rev, updatedAt: payload.updatedAt });
  }

  // 账号信息
  if (pathname === '/api/me' && req.method === 'GET') {
    const username = userFromReq(req);
    if (!username) return json(res, 401, { error: '未登录' });
    const users = loadUsers();
    const u = users[username] || {};
    return json(res, 200, {
      username,
      hasPassword: !!u.hash,
      createdAt: u.createdAt || null
    });
  }

  return json(res, 404, { error: '接口不存在' });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';

  const file = path.join(PUBLIC_DIR, p);
  // 防路径穿越
  if (!path.resolve(file).startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA 兜底：找不到文件就回首页
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(home);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(buf);
  });
}

/* ---------------- 入口 ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(err => {
      console.error('[api]', pathname, err.message);
      if (!res.headersSent) json(res, 500, { error: '服务器错误：' + err.message });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  DDL 不慌 · 服务已启动');
  console.log('  ─────────────────────────────');
  console.log('  本机访问：  http://localhost:' + PORT);
  console.log('  数据目录：  ' + DATA_DIR);
  console.log('');
  console.log('  手机访问请用电脑局域网 IP，例如 http://192.168.x.x:' + PORT);
  console.log('');
});
