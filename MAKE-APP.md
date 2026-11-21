# 做成 App（安卓安装包 APK）

目标：手机上有个图标，点开就是你的应用，**登录一次之后，以后打开直接就能用**，不用输网址、不用再登录。

---

## 先说清楚现实

| 事实 | 说明 |
|---|---|
| 我这台机器编不出 APK | 没有 Java / Android SDK / gradle，装它们要几个 GB 且不一定成功 |
| **但可以云端编译** | 推到 GitHub，它自动帮你编译，你只负责下载 APK 装上 |
| **必须有后端才有账号** | 你还没部署过后端，所以**第一步必须先部署**，否则装上的 App 只是一份本地数据 |

所以顺序是：**先部署后端 → 再打包 APK**。两步都不用你装开发环境。

---

## 第一步：部署后端，拿到网址（必须先做）

### 1-1 推到 GitHub

在项目目录执行：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/ddl-planner.git
git push -u origin main
```

没有 git 就在 GitHub 网页上直接上传整个项目文件夹（要包含 `server.js`、`package.json`、`src/`、`app/`、`build.js`）。

### 1-2 Render 一键部署

本项目已带 `render.yaml`：

1. 打开 [render.com](https://render.com) → 用 GitHub 登录
2. **New +** → **Blueprint**
3. 选你的仓库 → Render 会自动读 `render.yaml` → 点 **Apply**
4. 等 2～3 分钟，得到网址，形如：

```
https://ddl-planner-xxxx.onrender.com
```

**把这个网址记下来，第二步要用。**

### 1-3 先验证后端活着

浏览器打开：

```
https://你的地址.onrender.com/api/health
```

看到 `{"ok":true,...}` 就说明成功。

---

## 第二步：云端编译 APK

### 2-1 确认工作流文件在仓库里

项目里已有：

```
.github/workflows/build-apk.yml
```

推到 GitHub 后，仓库页面顶部会多出一个 **Actions** 标签。

### 2-2 触发编译

1. 仓库页 → **Actions**
2. 左侧点 **Build Android APK**
3. 右边点 **Run workflow**
4. 在 `backend_url` 里填**第一步拿到的网址**（例如 `https://ddl-planner-xxxx.onrender.com`）
5. 点绿色的 **Run workflow**

> 这一步很关键：填了地址，打出来的 App 就"开箱即连"，用户不用填服务器地址。

### 2-3 等编译，下载 APK

- 刷新页面，会看到一条运行记录，黄色圆点 = 编译中
- 大约 **5～10 分钟**（第一次要下载依赖，慢一些）
- 变绿勾后，点进这次运行 → 页面底部 **Artifacts** → 下载 `ddl-buhuang-apk`

下载下来是个 zip，解压里面就是 `app-debug.apk`。

---

## 第三步：装到手机上

### 3-1 传文件

把 `app-debug.apk` 用微信 / QQ / 数据线传到安卓手机。

### 3-2 允许安装

安卓会提示"未知来源应用"，这是正常的（因为它不是从应用商店装的）：

- 点弹窗里的**设置** → 打开「允许来自此来源」
- 返回 → 继续安装

### 3-3 打开就能用

装好后桌面会出现 **DDL不慌** 图标。

1. 点开 → 直接进入，**不会让你填网址**
2. 第一次点右上「登录」→ 输入账号名 → 注册
3. **以后每次打开：已经登录着，数据自动同步，你不用做任何操作**

---

## 「一登录就能用」是怎么实现的

技术上做了三件事：

| 机制 | 作用 |
|---|---|
| **打包时预置后端地址** | `build.js --backend=你的网址` 把地址写进 `config.js`，App 一启动就知道连哪 |
| **登录状态持久化** | token 存本地，重开 App 自动恢复会话 |
| **启动时静默同步** | 打开即拉取云端最新数据，无需手动点"刷新" |

对应测试 `test/appmode.test.js` 13 项，已验证：

- 预置地址后能连上后端
- 重开页面仍是登录态，无需再登录
- 数据自动拉回
- 登录过期时自动降级为本地模式，不会卡死
- 断网时用本地数据，不阻塞

---

## 常见问题

### 编译失败：`SDK location not found`

工作流里已经装了 Android SDK。如果还报错，检查 `.github/workflows/build-apk.yml` 里 `setup-android` 步骤在不在。

### 编译失败：`gradlew: Permission denied`

已在工作流里加了 `chmod +x android/gradlew`。如果仍报错，在仓库里执行：

```bash
git update-index --chmod=+x android/gradlew
```

### 装好后打开是白屏

多半是没填后端地址，或地址填错。重新跑一次 workflow，`backend_url` 填对的地址。

### 打开提示"还没连上云服务，当前是本地模式"

说明 App 连不上后端。检查：

1. 后端网址在浏览器里能打开吗（`/api/health`）
2. Render 免费实例会休眠，第一次打开要等 30 秒唤醒
3. 地址末尾不要带 `/`

### 换了后端地址怎么办

不用改代码，重新跑一次 workflow，`backend_url` 填新地址，重新装 APK 即可。

### 我想改 App 名字 / 图标

- 名字：改 `capacitor.config.json` 里的 `appName`
- 图标：`npx cap add android` 生成工程后，替换 `android/app/src/main/res/mipmap-*/ic_launcher.png`

### 想要正式签名的 APK（能上架、能长期更新）

当前是 debug 签名，自己装没问题，但不能上应用商店。要正式签名需要：

1. 生成 keystore
2. 把证书加进 GitHub Secrets
3. 改用 `assembleRelease`

这一步较复杂，个人自用不需要。

---

## 关于 iPhone

苹果**不给分发自签名的安装包**。iPhone 上只有两条路：

| 方式 | 成本 | 效果 |
|---|---|---|
| 添加到主屏幕（PWA） | 免费 | 有图标、全屏、能离线，已足够 |
| 开发者账号签名 | 99 美元/年 | 真正的 App，还要每年续 |

苹果用 Safari 打开你的网址 → 分享 → **添加到主屏幕**，效果接近 App。本项目已针对这个优化过（全屏、主题色、图标）。

---

## 一句话总结

```
① Render 部署后端 → 拿到 https 网址
② GitHub Actions 里填这个网址 → 云端编译 → 下载 APK
③ 传到手机装上 → 打开即用，登录一次永久记住
```

全程不需要在你电脑上装 Java / Android Studio。
