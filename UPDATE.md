# 以后怎么更新 App

更新分两种，**你只需要关心第一种**：

| 你改了什么 | 怎么更新 | 用户要做什么 |
|---|---|---|
| 网页代码（界面、算法、修 bug）—— **99% 的情况** | 推代码，自动部署 | 什么都不用做 |
| 安卓壳子本身（改 App 名字、图标、要新权限） | 重新编译 APK | 重新装一次 |

下面先说最重要的：**大多数更新用户无感**。

---

## 一、日常更新：改网页代码（最常见）

### 情况 A：你部署在 Render / 服务器上（带后端）

**流程：改代码 → 推送 → 自动部署完成**

```bash
# 1. 改完代码后，先升版本号（方便确认更新生效）
#    打开 package.json，把 "version": "1.0.0" 改成 "1.0.1"

# 2. 重新构建
node build.js

# 3. 推送
git add .
git commit -m "更新：修复了XX，新增了YY"
git push
```

Render 检测到推送后**自动重新部署**，1～2 分钟完成。

**用户这边**：打开 App 就是新版本，**不需要做任何操作**。
如果页面还显示旧的，下拉刷新或等 Service Worker 自动更新（会弹「有新版本可用」提示）。

### 情况 B：纯静态托管（GitHub Pages）

```bash
# 1. 升版本号（package.json）
# 2. 重建
node build.js

# 3. 把 app/ 里改动的文件重新上传到 GitHub
git add app/
git commit -m "更新"
git push
```

GitHub Pages 约 1 分钟生效。

> ⚠️ 用静态托管时，**必须手动改 `src/sw.js` 里的缓存版本号**：
> ```js
> const CACHE = 'ddl-planner-v3';   // 改成 v4、v5...
> ```
> 否则用户浏览器会用旧缓存，看不到更新。

### 让 Service Worker 生效的最佳实践

每次发版做这一步（防止用户卡在旧版本）：

```bash
# 打开 src/sw.js，把版本号 +1
const CACHE = 'ddl-planner-v4';   // 原来是 v3

node build.js
git add . && git commit -m "发版 v1.0.2" && git push
```

---

## 二、更新安卓 APK（少数情况）

**什么时候需要**：

- 想改 App 在手机桌面上的**名字**
- 想换**图标**
- 要新增系统权限（如通知震动）
- 改了 `capacitor.config.json`

**只是改网页内容，不需要重新打包 APK** —— App 里加载的是打包进去的网页，但你部署到服务器的新版本，
如果 App 配了后端地址，它会连服务器拿最新数据；不过**界面代码是打包在 APK 里的**。

> 重要：如果你想让 App 内的界面也跟着更新，就必须重新打包 APK。
> 想避免这个麻烦，见下方「三、让 App 自动加载线上版本」。

### 重新打包步骤

```bash
# 1. 升版本号
#    package.json 的 version 改成 1.1.0
#    （build.js 会自动注入到 App 里）

# 2. 构建
node build.js --backend=https://你的后端地址

# 3. 推送
git add .
git commit -m "App v1.1.0"
git push

# 4. 去 GitHub → Actions → Build Android APK → Run workflow
#    backend_url 填你的后端地址 → 等待 → 下载新 APK
```

**用户这边**：下载新 APK，覆盖安装（**数据不会丢**，因为存在本地和云端）。

### 覆盖安装会丢数据吗？

**不会。** 因为：

- 本地数据存在 App 的存储空间里，覆盖安装会保留
- 如果登录了账号，数据还在云端

**唯一会丢的情况**：卸载后重装（不是覆盖）。所以提示用户「直接装，别先卸载」。

---

## 三、让 App 自动加载线上版本（进阶，可选）

如果你希望**改了网页无需重新打包 APK**，可以让 App 直接加载你的线上地址：

改 `capacitor.config.json`：

```json
{
  "appId": "com.ddlbuhuang.app",
  "appName": "DDL不慌",
  "webDir": "app",
  "server": {
    "url": "https://你的后端地址",
    "androidScheme": "https"
  }
}
```

这样 App 打开时直接加载线上网页，**你在服务器上更新，App 立刻就是新版**，不用重新打包。

**代价**：

- 必须联网才能打开（离线不可用）
- 应用商店通常不允许这种"套壳"上架（个人自用没问题）
- 网络差时启动会慢

**建议**：自己用、想省事 → 用这个方案；想离线可用 → 保持现状（打包进去）。

---

## 四、版本号怎么改

版本号在两个地方，**改 `package.json` 就够了**：

```json
{
  "version": "1.0.1"
}
```

`build.js` 会自动把它写进 App，你可以在**设置页底部**看到：

```
DDL 不慌 · 数据本地存储，可登录同步
版本 1.0.1 · 构建于 2026-11-18 21:37
```

也可以点「设置 → 检查更新」看当前版本。

**怎么判断更新成功了**：看这个版本号变没变。

---

## 五、更新前必做：备份

更新一般不会丢数据，但稳妥起见：

**设置 → 备份数据** → 导出 JSON 存到网盘。

万一出问题：**设置 → 恢复数据** → 选那个 JSON 文件。

---

## 六、常见问题

### 更新后手机上还是旧版

按顺序排查：

1. **看设置页底部的版本号** —— 没变说明没更新成功
2. 网页版：强制刷新（下拉）；或关掉重开
3. 改了 `sw.js` 的 CACHE 版本号吗？没改会拿旧缓存
4. APK：这次改的是网页代码，需要重新打包 APK 才能变

### 推送后 Render 没重新部署

- 检查 Render 控制台 **Events** 标签有没有新的部署记录
- 免费实例可能因为休眠没响应，手动点 **Manual Deploy**

### 重新打包 APK 后装不上

- 版本号必须**大于**已装的版本（Android 规则）
- 或者先卸载旧的（**会丢本地数据**，先备份）

### 用户数据在更新后消失了

检查**存储键名有没有被改**。这三个键名必须保持不变：

```
ddl-planner-v1          ← 主数据
ddl-planner-autobackup  ← 自动备份
ddl-planner-auth        ← 登录状态
```

`test/update.test.js` 里专门有这个检查，跑一次就知道。

### 想回滚到上一版

```bash
git log --oneline          # 找到上一个 commit
git revert <commit-id>     # 或 git reset --hard <commit-id>
git push
```

Render 会自动重新部署回旧版本。

---

## 一句话总结

```
日常改网页 → 改版本号 → node build.js → git push → 完事，用户无感
改 App 壳子 → 同上 + Actions 重新编译 APK → 用户覆盖安装
```

**发版前记得跑一遍测试：**

```bash
node test/core.test.js && node test/repeat.test.js && node test/server.test.js
node test/update.test.js
```
