# 部署上线完整指南

> 💡 如果你是第一次部署、只想尽快拿到网址 → 先看 **[GET-ONLINE.md](GET-ONLINE.md)**（手把手版）
> 本文是完整参考：多平台配置、运维、排错。

目标：让应用有一个**固定网址**，手机随时能打开、能登录账号、数据存云端。
所有方案都基于本项目的 `server.js`（零依赖，不需要 `npm install`）。

---

## 先搞清楚：三种用法差别在哪

| 用法 | 有没有固定网址 | 能不能登录账号 | 数据在哪 | 适合谁 |
|---|---|---|---|---|
| 单文件 HTML | ❌ | ❌ | 浏览器本地 | 只想自己用、不想折腾 |
| 纯静态托管（GitHub Pages 等） | ✅ | ❌ | 浏览器本地 | 只要手机能打开 |
| 本机跑 server.js | ✅ 局域网内 | ✅ | 你自己电脑 | 家里/宿舍内多设备 |
| 部署到云服务器 | ✅ 公网 | ✅ | 云服务器 | 真正的"随时随地用" |

**要"登录账号、换设备能取回"，必须有后端。** 下面从最简单往最正式排。

> ⚠️ 常见误区：GitHub Pages / Vercel 静态 / Netlify 属于**静态托管**，
> 它们只存文件、**不能运行 `server.js`**。把 `app/` 放上去应用能跑，
> 但账号功能会提示"没有后端服务"（这是预期行为，应用里也会给出说明）。
> 要账号 → 用方案 B。

---

## 方案 A：本机跑起来（5 分钟，先验证能用）

### 步骤

1. 确认装了 Node.js（`node -v` 有版本号即可）
2. 在本项目目录打开终端，执行：

```bash
node server.js
```

看到这些就成功了：

```
  DDL 不慌 · 服务已启动
  ─────────────────────────────
  本机访问：  http://localhost:3000
  数据目录：  ...\server-data
```

3. 电脑浏览器打开 `http://localhost:3000` → 能正常用、能注册账号

### 让手机也能访问

手机和电脑连**同一个 Wi-Fi**，然后：

1. 电脑上查本机 IP：
   - Windows：`ipconfig`，找"IPv4 地址"，例如 `192.168.1.5`
   - Mac/Linux：`ifconfig` 或 `ip addr`
2. 手机浏览器访问 `http://192.168.1.5:3000`

连不上时，多半是 Windows 防火墙拦了。首次运行 Node 时弹出的"允许访问"要点**允许**。
如果当时点了取消，去「Windows 安全中心 → 防火墙 → 允许应用通过防火墙」把 Node.js 勾上（专用网络）。

### 换端口

```bash
# Windows PowerShell
$env:PORT=8080; node server.js

# Mac / Linux
PORT=8080 node server.js
```

### 数据存在哪

项目目录下的 `server-data/`：

```
server-data/
├── users.json           # 账号（只存密码哈希，不存明文）
└── data/
    ├── <hash1>.json     # 每个账号一份任务数据
    └── <hash2>.json
```

**备份就复制整个 `server-data` 文件夹。** 想换机器，把它一起搬过去即可。

---

## 方案 B：部署到公网（推荐，真正随时随地用）

下面三种任选一种。都支持"推代码 → 自动部署 → 得到 https 网址"。

### 部署前必须做的准备

`server.js` 会同时提供网页和 API，所以**必须把 `app/` 目录一起带上**。确认目录结构：

```
你的仓库/
├── server.js          ← 入口
├── package.json
└── app/               ← 前端文件（构建产物）
    ├── index.html
    ├── styles.css
    ├── core.js
    ├── state.js
    ├── sync.js
    ├── views.js
    ├── main.js
    ├── manifest.webmanifest
    └── sw.js
```

如果 `app/` 不存在，先在本地跑一次：

```bash
node build.js
```

### 还要确认 package.json 有启动命令

```json
{
  "name": "ddl-planner",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "build": "node build.js"
  }
}
```

---

### B-1：Render（最省事，有免费额度）

1. 把项目推到 GitHub（一个仓库即可）
2. 打开 [render.com](https://render.com) → 注册 → **New → Web Service**
3. 连接你的 GitHub 仓库
4. 按下面填：

| 配置项 | 填什么 |
|---|---|
| Name | `ddl-planner`（随便起） |
| Region | 选离你近的，如 Singapore |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `node build.js` |
| Start Command | `node server.js` |
| Instance Type | Free 即可 |

5. 点 **Create Web Service**，等 1～2 分钟
6. 拿到网址，形如 `https://ddl-planner-xxxx.onrender.com` → 手机打开就能用

> ⚠️ Render 免费实例**闲置一段时间会休眠**，下次访问要等 30 秒左右唤醒。
> 数据存在容器临时磁盘上，**重新部署会清空**。想持久化见下方"数据持久化"。

### B-2：Railway（配置简单，付费但便宜）

1. 推代码到 GitHub
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
3. 选中仓库，Railway 会自动识别 Node 项目
4. 在 **Settings → Deploy** 里确认：
   - Build Command：`node build.js`
   - Start Command：`node server.js`
5. 在 **Settings → Networking → Generate Domain** 生成公网域名

Railway 默认会注入 `PORT` 环境变量，`server.js` 已经读它，不用额外配置。

### B-3：自己的 VPS（最可控，需要域名和一点运维）

适合有服务器的人。以 Ubuntu + Nginx 为例。

**1. 上传代码并装 Node**

```bash
# 服务器上
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

cd /var/www
sudo git clone <你的仓库地址> ddl-planner
cd ddl-planner
sudo node build.js
```

**2. 用 pm2 常驻运行**

```bash
sudo npm i -g pm2
sudo PORT=3000 pm2 start server.js --name ddl-planner
sudo pm2 startup && sudo pm2 save
```

**3. Nginx 反向代理**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 8m;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ddl /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**4. 上 HTTPS（必须，否则不能装 PWA、不能用通知）**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot 会自动改好 Nginx 配置并续期。

**5. 数据持久化**

`server-data/` 在项目目录里，备份策略：

```bash
# 每天凌晨 3 点打包备份
echo "0 3 * * * cd /var/www/ddl-planner && tar czf /root/backup-$(date +\%F).tar.gz server-data" | sudo crontab -
```

---

## 部署后必做检查

打开你的网址，逐项确认：

- [ ] 页面能打开，不是白屏
- [ ] 点右上「登录」→ 输入账号名 → 能注册成功
- [ ] 加一个任务 → 刷新页面 → 任务还在
- [ ] 换个浏览器登录同一账号 → 任务能取回来（这是账号功能的核心）
- [ ] 手机浏览器菜单里出现「添加到主屏幕」/「安装应用」
- [ ] 装上图标后，从图标进入能正常用

---

## 常见问题

### 页面白屏 / 404

多半是 `app/` 没有一起部署。在服务器上确认：

```bash
ls app/index.html
```

没有就重新 `node build.js` 并提交。

### 登录提示"没连上服务器"

打开浏览器控制台（F12），看 `/api/health` 请求：

- **404** → 后端没起来，或反向代理没转发 `/api`
- **CORS 报错** → 前端和 API 不同域，登录界面里把"服务器地址"填成你的 API 域名
- **连接超时** → 服务在休眠（Render 免费版）

### 注册提示"账号名已被使用"

账号名全局唯一。换一个，或在 `server-data/users.json` 里确认（**改之前先停服务并备份**）。

### 改了代码但手机还是旧版

Service Worker 有缓存。做法：

1. 手机浏览器里强制刷新（下拉刷新或清站点数据）
2. 或改 `src/sw.js` 里的 `CACHE` 版本号（如 `ddl-planner-v3`）后重新部署

### 数据会不会丢

三种风险：

| 风险 | 应对 |
|---|---|
| 免费托管重启清盘（Render/Railway） | 挂持久卷，或定期在应用里「备份数据」导出 JSON |
| 服务器磁盘坏了 | 定期打包 `server-data` |
| 误删任务 | 应用内「备份数据」+「找回上次数据」 |

**最稳的组合**：云服务器 + 你设的自动备份 cron + 偶尔在应用里导出 JSON 存自己网盘。

---

## 安全说明（请认真看）

这套后端是**为个人/小团队自用**设计的，不是生产级产品：

- 密码用 PBKDF2（12 万次迭代 + 随机盐）哈希后才存盘，**不存明文**
- 会话 token 存在内存中，**服务重启后所有登录失效**（需要重新登录，数据不受影响）
- 没有做频率限制、没有找回密码、没有邮箱验证
- **没有 HTTPS 就别用密码**（明文传输），要么部署时配好 HTTPS，要么只用账号名免密登录

如果你的数据很敏感，建议部署在 HTTPS 下，并且只自己用。

---

## 一页速查

```bash
# 本地开发
node build.js          # 构建前端到 app/ 和 dist/
node server.js         # 起服务（默认 3000）

# 测试
node test/core.test.js       # 算法 106 项
node test/repeat.test.js     # 重复/时间段 56 项
node test/server.test.js     # 账号接口 33 项
node test/persist.test.js    # 本地存储 12 项
node test/recover.test.js    # 数据找回 14 项
node test/feature.test.js    # 新功能端到端 27 项
node test/hosting.test.js    # 部署形态（静态/带后端）14 项

# 数据目录
server-data/            # 账号与云端数据，备份它就够了
```
