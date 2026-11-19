# 从零拿到你的网址（手把手版）

你想问的其实是两件事：

1. **「传到静态托管」是什么意思** —— 就是把文件放到一台 24 小时开着的服务器上，它会给你一个网址
2. **「我应该怎样获得网址」** —— 下面给你三条路，按你的需求选一条做就行

先说结论，省得你走弯路：

> ⚠️ **如果你要账号登录功能，不能用静态托管。**
> GitHub Pages / Vercel 静态 / Netlify 只能放文件，**不能运行 `server.js`**，
> 所以账号按钮点了会提示"没有后端服务"。
> 要账号 → 走**路线 B**；不要账号、只想手机能用 → **路线 A** 就够。

---

## 先做这一步（三条路线都要）

在项目目录里打开终端，执行：

```bash
node build.js
```

会看到：

```
✓ 单文件版：dist/DDL不慌.html
✓ 站点版：app/  （支持离线缓存、添加到主屏幕、账号同步）
```

这个 `app/` 文件夹就是"要上传的网页"。**必须先跑这一步**，否则上传的是旧版本。

---

## 路线 A：只要能用，不要账号（最简单，10 分钟）

适合：自己一个人用，数据存手机里就够。

### A-1 注册 GitHub 并建仓库

1. 打开 [github.com](https://github.com) 注册（已有账号跳过）
2. 右上角 **+** → **New repository**
3. 填：
   - Repository name：`ddl-planner`
   - 选 **Public**（免费）
   - 不用勾任何初始化选项
4. 点 **Create repository**

### A-2 上传 app 文件夹里的文件

新仓库页面会有 **uploading an existing file** 链接，点它。

把 `app/` 里的**这 9 个文件**全选拖进去：

```
index.html
styles.css
core.js
state.js
sync.js
views.js
main.js
manifest.webmanifest
sw.js
```

> 注意：是 `app/` **里面的**文件，不要连文件夹一起拖，否则会多一层路径。

点 **Commit changes**。

### A-3 开启 GitHub Pages

1. 仓库页 → **Settings**（顶部）
2. 左侧 **Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，目录选 `/ (root)`
5. 点 **Save**

等 1～2 分钟刷新页面，顶部会出现绿色提示，网址形如：

```
https://你的用户名.github.io/ddl-planner/
```

**这就是你的网址。**

### A-4 手机上用起来

1. 手机浏览器打开这个网址
2. 确认能加任务、能看日历
3. 浏览器菜单 → **添加到主屏幕**
4. 之后从图标进入即可

> 数据存在手机浏览器本地。定期去设置里「备份数据」导出 JSON，存到网盘。

**这条路线的限制**：账号登录用不了（点开会看到红色提示 + 「查看原因」说明，属正常）。

---

## 路线 B：要账号登录 + 跨设备同步（推荐，20 分钟）

### B-1 把项目推到 GitHub

在项目目录执行（需先装 Git）：

```bash
git init
git add server.js package.json DEPLOY.md README.md
git add app/
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/ddl-planner.git
git push -u origin main
```

> 也可以直接在 GitHub 网页上把 `server.js`、`package.json` 和整个 `app/` 文件夹拖上去。

确认仓库里能看到：

```
server.js
package.json
app/index.html
app/sync.js
...

```

### B-2 在 Render 上部署

1. 打开 [render.com](https://render.com) → **Get Started** → 用 GitHub 账号登录
2. 控制台点 **New +** → **Web Service**
3. 点 **Connect** 选你的 `ddl-planner` 仓库（首次要授权 Render 访问 GitHub）
4. 填配置（**这一步最关键**）：

| 字段 | 填什么 |
|---|---|
| **Name** | `ddl-planner` |
| **Region** | `Singapore`（离你近） |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `node build.js` |
| **Start Command** | `node server.js` |
| **Instance Type** | `Free` |

5. 点 **Create Web Service**
6. 等 1～3 分钟，底部日志出现：

```
DDL 不慌 · 服务已启动
本机访问：  http://localhost:10000
```

7. 页面顶部会出现你的网址，形如：

```
https://ddl-planner-xxxx.onrender.com
```

**这就是你的网址**，复制它。

### B-3 验证账号能用

1. 电脑或手机打开这个网址
2. 点右上角 **登录**
3. **如果没看到红色警告** → 后端通了 ✅
4. 输入账号名（比如 `xiaoming`），密码留空，点 **注册**
5. 加几个任务
6. 换个浏览器，登录同一个账号名 → **任务应该自动出现**

如果出现了红色警告，往下看"排错"。

### B-4 手机添加到主屏幕

1. 手机浏览器打开你的网址
2. iPhone：分享按钮 → **添加到主屏幕**；安卓：菜单 → **安装应用**
3. 从图标进入，全屏运行，数据存云端

---

## 路线 C：用自己电脑当服务器（只在同一 Wi-Fi 内）

不想注册任何平台，只想在家里/宿舍用：

```bash
node build.js
node server.js
```

终端会打印：

```
本机访问：  http://localhost:3000
手机访问请用电脑局域网 IP，例如 http://192.168.x.x:3000
```

1. 查你自己电脑的 IP：Windows 运行 `ipconfig`，找 **IPv4 地址**
2. 手机连**同一个 Wi-Fi**，浏览器访问 `http://那个IP:3000`
3. 电脑关掉或睡眠，手机就打不开了 —— 这是这条路线的硬限制

---

## 排错：常见 5 个问题

### 1. 打开网址是 404 / 白屏

- GitHub Pages：确认文件在**仓库根目录**，不是套了一层 `app/app/index.html`
- Render：看日志有没有 `Cannot find module`，通常是没提交 `server.js`

### 2. 账号界面有红色"没有后端服务"

说明你部署的是纯静态版本。要么接受不要账号（走路线 A），要么按路线 B 重新部署。

### 3. Render 打开很慢（30 秒）

免费实例闲置会休眠，第一次访问要唤醒。等一会儿就好，属正常。

### 4. 手机上改了代码还是旧版

Service Worker 有缓存。做法：
1. 手机上把该站点数据清掉，或
2. 把 `src/sw.js` 里的 `const CACHE = 'ddl-planner-v2'` 改成 `v3`，重新 `node build.js` 再部署

### 5. 注册提示"这个账号名已被使用"

账号名全局唯一，换个名字。或者那本来就是你之前注册的，直接点**登录**。

---

## 一句话总结

| 你的需求 | 走哪条 | 大概耗时 |
|---|---|---|
| 只自己用，手机能打开 | 路线 A（GitHub Pages） | 10 分钟 |
| 要账号、要换设备能同步 | 路线 B（Render） | 20 分钟 |
| 只在家里 Wi-Fi 用 | 路线 C（自己电脑） | 3 分钟 |

拿到网址后，**一定要在浏览器里「添加到主屏幕」**，才算真正像 App 一样用。
