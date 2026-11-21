/*
 * build.js —— 把 src/ 打包成：
 *   1. dist/DDL不慌.html   单文件，双击即用
 *   2. app/                站点版 / App 版（供 PWA、Capacitor 使用）
 *
 * 用法：
 *   node build.js
 *   node build.js --backend=https://your-app.onrender.com   # 给 App 预置后端地址
 *
 * 也可以用环境变量：BACKEND_URL=https://... node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const APP = path.join(ROOT, 'app');

/* ---------- 读取后端地址 ---------- */
function readBackendArg() {
  const fromArg = process.argv.find(a => a.startsWith('--backend='));
  if (fromArg) return fromArg.slice('--backend='.length).trim();
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.trim();
  return '';
}
let BACKEND_URL = readBackendArg();

// 容错：允许用户填 www.xxx.com 这种没写协议的
if (BACKEND_URL && !/^https?:\/\//i.test(BACKEND_URL)) {
  BACKEND_URL = 'https://' + BACKEND_URL;
}
// 去掉末尾斜杠
BACKEND_URL = BACKEND_URL.replace(/\/+$/, '');

function read(f) { return fs.readFileSync(path.join(SRC, f), 'utf8'); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }

/* ---------- 生成带后端地址的 config.js ---------- */
function configJs() {
  let out = read('config.js');

  // 注入后端地址
  if (BACKEND_URL) {
    out = out.replace(
      /BACKEND_URL:\s*''/,
      "BACKEND_URL: '" + BACKEND_URL.replace(/'/g, "\\'") + "'"
    );
  }

  // 注入版本号与构建时间（用于确认更新是否生效）
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.0';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const buildTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const buildId = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    pad(now.getHours()) + pad(now.getMinutes());

  // 注入版本号、构建时间、构建 id
  out = out.replace(/VERSION:\s*'[^']*'/, "VERSION: '" + version + "'");
  out = out.replace(/BUILD_TIME:\s*'[^']*'/, "BUILD_TIME: '" + buildTime + "',");
  // 在最后一行 BUILD_TIME 之后补上 BUILD_ID
  if (/BUILD_ID:/.test(out)) {
    out = out.replace(/BUILD_ID:\s*'[^']*'/, "BUILD_ID: '" + buildId + "'");
  } else {
    out = out.replace(/(BUILD_TIME:\s*'[^']*',?)/, "$1\n  BUILD_ID: '" + buildId + "'");
  }
  return out;
}

const SCRIPTS = ['config.js', 'core.js', 'local-profile.js', 'state.js', 'sync.js', 'profile-ui.js', 'views.js', 'main.js'];

/* ================= 1. 单文件版 ================= */
let html = read('index.html');
const css = read('styles.css');

html = html.replace('<link rel="stylesheet" href="./styles.css">', () => `<style>\n${css}\n</style>`);
// 单文件版没有 sw / manifest，避免 file:// 下报错
html = html.replace('<link rel="manifest" href="./manifest.webmanifest">', '');

SCRIPTS.forEach(f => {
  const tag = `<script src="./${f}"></script>`;
  const code = f === 'config.js' ? configJs() : read(f);
  if (!html.includes(tag)) {
    throw new Error('index.html 里找不到脚本标签：' + tag);
  }
  html = html.replace(tag, () => `<script>\n/* ==== ${f} ==== */\n${code}\n</script>`);
});

if (/<\/script>/i.test(css)) throw new Error('CSS 中含 </script>');

mkdir(DIST);
const outFile = path.join(DIST, 'DDL不慌.html');
fs.writeFileSync(outFile, html, 'utf8');
const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`✓ 单文件版：dist/DDL不慌.html  (${kb} KB)`);

/* ================= 2. 站点 / App 版 ================= */
mkdir(APP);

// 普通文件直接复制
['index.html', 'styles.css', 'core.js', 'local-profile.js', 'state.js', 'sync.js',
  'profile-ui.js', 'views.js', 'main.js', 'manifest.webmanifest', 'sw.js'].forEach(f => {
  fs.copyFileSync(path.join(SRC, f), path.join(APP, f));
});

// config.js 需要注入后端地址
fs.writeFileSync(path.join(APP, 'config.js'), configJs(), 'utf8');

console.log('✓ 站点版：app/  （纯本地存储 · 可离线 · 可打包 APK）');
if (BACKEND_URL) {
  console.log('  ↳ 已预置后端地址：' + BACKEND_URL + '（当前版本不联网，此行可忽略）');
}

/* ---------- 校验：确保 config.js 被正确引入 ---------- */
const appIndex = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
if (!appIndex.includes('config.js')) {
  console.warn('⚠️  app/index.html 里没有引用 config.js，App 将无法预置后端地址');
}
