# 部署后端（一步一步）

目标：让应用有个公网网址，能登录账号、数据存云端。

**当前状态**：你的仓库 `2026-victory/ddl-planner` 还是**空的**，必须先上传文件，才能部署。

---

## 第 0 步：上传文件（必须先做）

仓库空着的话，Render 会直接报错「找不到 server.js」。

### 最简做法：用我打好的上传包

项目根目录有个 **`ddl-planner-上传包.zip`**（165 KB，33 个文件）。

1. 解压这个 zip 到一个文件夹
2. 打开 https://github.com/2026-victory/ddl-planner
3. 点 **"uploading an existing file"**
4. 把解压出来的**所有内容**拖进去（包括 `.github`、`app`、`src`）
5. 底部填 `初始化项目` → 点 **Commit changes**

> **为什么用 zip**：`.github` 和 `.gitignore` 是隐藏文件，直接拖容易漏。
> 解压后如果看不到 `.github`，在资源管理器「查看」里勾上「隐藏的项目」。

### 上传后自检

刷新仓库首页，应该看到这些：

```
✅ .github/     ← 进去有 workflows/build-apk.yml
✅ app/         ← 10 个文件
✅ src/         ← 10 个文件
✅ server.js
✅ package.json
✅ build.js
✅ render.yaml
✅ capacitor.config.json
```

少任何一个都会影响后续步骤。

---

## 第 1 步：注册 Render

打开 [render.com](https://render.com) → **Get Started**

推荐用 **GitHub 账号登录**（Sign in with GitHub），这样能直接读你的仓库，不用额外配置。

---

## 第 2 步：用 Blueprint 一键部署

项目里带了 `render.yaml`，Render 会自动读它，不用手填参数。

1. 登录后进入控制台
2. 点右上角 **New +**
3. 选 **Blueprint**
4. 如果第一次用，会让你授权访问 GitHub 仓库 → 点 **Configure account** → 选 **All repositories** 或只勾 `ddl-planner` → **Save**
5. 回到页面，选择 **2026-victory/ddl-planner**
6. Render 会解析 `render.yaml`，显示一个服务名叫 `ddl-planner`
7. 点 **Apply**（或 Create Resources）

### 不用 Blueprint 的手动方式

如果 Blueprint 出问题，改用这个：

1. **New +** → **Web Service**
2. 连你的仓库
3. 按下面填：

| 字段 | 填什么 |
|---|---|
| Name | `ddl-planner` |
| Region | `Singapore` |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `node build.js` |
| Start Command | `node server.js` |
| Instance Type | `Free` |

4. 点 **Create Web Service**

---

## 第 3 步：等部署完成

页面会自动跳到日志界面，能看到：

```
==> Cloning from https://github.com/2026-victory/ddl-planner...
==> Running 'node build.js'
✓ 单文件版：dist/DDL不慌.html
✓ 站点版：app/
==> Running 'node server.js'
  DDL 不慌 · 服务已启动
  本机访问：  http://localhost:10000
```

**看到「服务已启动」就成功了**，大约 2～3 分钟。

如果显示红色的 `Build failed` 或 `Deploy failed`，看本文最后的排错。

---

## 第 4 步：拿到你的网址

页面顶部会有个网址，形如：

```
https://ddl-planner-xxxx.onrender.com
```

**这个网址要记下来**，后面编 APK 时要用。

---

## 第 5 步：验证能不能用

### 5-1 测后端活着

浏览器打开：

```
https://你的网址.onrender.com/api/health
```

看到这样就对了：

```json
{"ok":true,"time":"2026-11-19T..."}
```

### 5-2 测网页能开

浏览器打开你的网址根路径：

```
https://你的网址.onrender.com
```

应该看到「今天」页面和示例任务。

### 5-3 测账号能用（最关键）

1. 点右上角 **登录**
2. 输入账号名，比如 `xiaoming`，密码留空
3. 点 **注册**
4. 加一两个任务
5. **换一个浏览器**（或手机隐身模式）打开同一网址
6. 登录同一个账号名 → **任务应该自动出现**

这一步通了，说明后端完全正常。

---

## 第 6 步：手机添加到桌面

1. 手机浏览器打开你的网址
2. iPhone：分享 → **添加到主屏幕**
3. 安卓：菜单 → **安装应用 / 添加到主屏幕**
4. 从图标进入，全屏运行

---

## 排错

### 部署失败：找不到 server.js

仓库是空的，或者文件传到 `app/` 子目录里去了。回到第 0 步重传。

### 部署失败：Build failed

点开日志看最后几行。常见原因：

| 错误 | 原因 | 解决 |
|---|---|---|
| `Cannot find module 'xxx'` | 缺文件 | 检查 `src/` 有没有传全 10 个文件 |
| `node: command not found` | Render 没识别 Node 环境 | 确认 `package.json` 里有 `"main": "server.js"` |
| `EADDRINUSE` | 端口冲突 | 一般不会，Render 会自动分配 |

### 打开网址显示 502 / 503

服务还在启动，等 30 秒刷新。免费实例休眠后唤醒需要时间。

### 打开很慢（30 秒）

Render 免费版闲置会休眠，第一次访问要唤醒。这是正常的，等一会儿就好。

### 账号登录提示「没有后端服务」

说明你打开的可能是静态托管版本，不是 Render 的。确认网址是 `xxx.onrender.com` 结尾。

### 数据丢了

**Render 免费实例的磁盘是临时的，重新部署会清空。**

解决方案：
1. 定期在应用里「设置 → 备份数据」导出 JSON
2. 想长期保存，升级到付费版并挂载 Persistent Disk（Render 控制台 → Disk → Add Disk，挂到 `/opt/render/project/src/server-data`）

---

## 部署完之后

后端有了，接下来可以：

1. **直接当网页用**：手机添加主屏幕即可
2. **打包安卓 APK**：见 [MAKE-APP.md](MAKE-APP.md)，编译时把后端网址填进去

---

## 一句话流程

```
上传文件到 GitHub → Render 选 Blueprint → Apply → 等 3 分钟 → 拿到网址
→ 测 /api/health → 测注册登录 → 完事
```
