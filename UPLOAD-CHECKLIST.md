# 上传到 GitHub 清单

仓库：https://github.com/2026-victory/ddl-planner
状态：**空仓库，默认分支 main**，可以直接上传。

---

## ⚠️ 先看这个：三个必须注意的点

1. **`.github` 是隐藏文件夹**，Windows 拖拽会漏掉 → 必须手动创建（见第 4 步）
2. **`app/` 和 `src/` 都要传**，缺一不可：
   - `src/` = 源码，Render 构建时从这里读取
   - `app/` = 构建产物，Capacitor 打包 APK 时用它
3. **`dist/`、`screenshots/`、`test/` 可以不传**（不影响运行，只影响本地测试和文档配图）

---

## 第一步：打开上传页面

仓库首页 → 点 **"uploading an existing file"** 链接
（或直接访问 `https://github.com/2026-victory/ddl-planner/upload/main`）

---

## 第二步：拖入【根目录】的 11 个文件

在资源管理器打开 `D:\dsh_workpalce\dsh creat\`，**只选这 11 个文件**拖进浏览器：

```
.gitignore
build.js
capacitor.config.json
DEPLOY.md
GET-ONLINE.md
MAKE-APP.md
package.json
README.md
render.yaml
server.js
UPDATE.md
```

> `.gitignore` 也是隐藏文件。资源管理器里勾选「查看 → 隐藏的项目」才看得到。
> 如果实在传不上，可以先跳过它（不影响部署，只影响将来用 git 时的忽略规则）。

---

## 第三步：拖入文件夹（app 和 src）

**可以继续在同一个页面拖入**，也可以分两次提交。

拖入：
```
app\     ← 整个文件夹，10 个文件
src\     ← 整个文件夹，10 个文件
```

GitHub 网页上传**支持拖整个文件夹并保留目录结构**。

拖完后，提交框里的路径应该长这样：

```
app/config.js
app/core.js
app/index.html
app/main.js
app/manifest.webmanifest
app/state.js
app/styles.css
app/sw.js
app/sync.js
app/views.js
src/config.js
...
src/views.js
```

**如果看到的是 `app/app/core.js` 这种嵌套路径，说明拖错了**——应该拖 `app` 文件夹本身，而不是它里面的文件。

然后：
- 底部 **Commit changes** 输入框填：`初始化项目`
- 选 **Commit directly to the main branch**
- 点绿色 **Commit changes**

---

## 第四步：手动创建 `.github/workflows/build-apk.yml`（关键！）

这个文件决定 APK 能不能编译，**必须单独创建**。

1. 回到仓库首页
2. 点 **Add file** → **Create new file**
3. 在文件名输入框里**直接输入完整路径**：

```
.github/workflows/build-apk.yml
```

> GitHub 会自动识别 `/` 并创建两级目录，输入时看到文件名变成 `.github/workflows/build-apk.yml` 就对了。

4. 把下面内容**完整复制粘贴**进大输入框：

```yaml
name: Build Android APK

on:
  workflow_dispatch:
    inputs:
      backend_url:
        description: '后端地址（例如 https://xxx.onrender.com，留空则不预置）'
        required: false
        default: ''
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 检出代码
        uses: actions/checkout@v4

      - name: 安装 Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 安装 Java 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: 安装 Android SDK
        uses: android-actions/setup-android@v3

      - name: 构建前端（注入后端地址）
        run: |
          if [ -n "${{ github.event.inputs.backend_url }}" ]; then
            node build.js --backend="${{ github.event.inputs.backend_url }}"
          else
            node build.js
          fi

      - name: 安装依赖
        run: npm install

      - name: 生成 Android 工程
        run: |
          if [ ! -d "android" ]; then
            npx cap add android
          fi
          npx cap sync android

      - name: 允许明文 HTTP（仅当后端是 http）
        run: |
          MANIFEST=android/app/src/main/AndroidManifest.xml
          if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
            sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$MANIFEST"
          fi

      - name: 授予 gradlew 执行权限
        run: chmod +x android/gradlew

      - name: 编译 Debug APK
        working-directory: android
        run: ./gradlew assembleDebug --no-daemon

      - name: 上传 APK
        uses: actions/upload-artifact@v4
        with:
          name: ddl-buhuang-apk
          path: android/app/build/outputs/apk/debug/*.apk
          retention-days: 30
```

5. 点 **Commit changes**

---

## 第五步：核对（1 分钟）

刷新仓库首页，根目录应该看到：

```
✅ .github/          ← 点进去应该有 workflows/build-apk.yml
✅ app/              ← 10 个文件
✅ src/              ← 10 个文件
✅ build.js
✅ package.json
✅ server.js
✅ render.yaml
✅ capacitor.config.json
✅ README.md
```

**再确认一件事**：点开 `.github/workflows/build-apk.yml`，
页面右上角如果不是「Raw / Blame / Delete」而是显示渲染后的内容，说明 YAML 语法没问题。

---

## 常见错误

### 传上去发现是 `app/app/core.js`

拖文件夹时多套了一层。删掉重传：拖 `app` 文件夹本身。

### `.github` 传不上去

用第四步的「Create new file」手动创建，这是最可靠的方式。

### 中文变成乱码

本项目所有文件都是 UTF-8。如果 GitHub 显示乱码，检查资源管理器是否改了编码——这个情况极少见，出现就告诉我。

### 想确认传对没有

告诉我，我可以直接查仓库内容核对。

---

## 传完之后

1. **先部署后端**：Render → New → Blueprint → 选这个仓库 → Apply
2. 拿到网址后测试 `你的网址/api/health`
3. 再回来跑 GitHub Actions 编译 APK

详见 [MAKE-APP.md](MAKE-APP.md)。
