/* ==========================================================================
 * config.js —— 构建时可替换的默认配置
 *
 * 打包 APK 时，只需要改这一个文件里的 BACKEND_URL，
 * 之后 App 打开就自动连这个服务器，用户不用填地址。
 *
 * 例：
 *   window.APP_CONFIG = { BACKEND_URL: "https://ddl-planner.onrender.com" };
 *
 * 留空则退化为「同源访问 / 手动填写地址」。
 * ========================================================================== */
window.APP_CONFIG = {
  // 你的后端地址，例如 "https://ddl-planner.onrender.com"
  // 打包前改这里即可
  BACKEND_URL: '',

  // App 名称（显示在手机桌面）
  APP_NAME: 'DDL 不慌',

  // 版本号 —— 打包时由 build.js 自动写入，用于确认「更新是否装成功」
  VERSION: '1.0.0',
  BUILD_TIME: '2026-11-21 12:14',
  BUILD_ID: '202611211214'
};
