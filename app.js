// app.js
App({
  globalData: {
    // 导出结果（config 页生成后传入 success 页），避免通过 URL 传长路径
    exportResult: null,
    // 云开发可用状态
    cloudReady: false,
  },
  onLaunch() {
    // 初始化云开发（环境 ID 见下方 env 字段；需在云开发控制台创建 users 与 userdata 集合）
    try {
      if (wx.cloud) {
        wx.cloud.init({
          // 显式指定环境（2026-09-22）。
          // 此前不传 env，走的是「默认环境」——而默认环境是**账号下第一个创建的云环境，
          // 且无法更改**（环境删掉它仍然是默认环境）。多环境时这会连到错误的环境，
          // 表现是「控制台里配好了、小程序却读不到」，而且**不报错**，极难排查。
          env: 'cloud1-d6gv17wvoe9486af1',
          traceUser: true,
        })
        this.globalData.cloudReady = true
      }
    } catch (e) {
      console.warn('[cloud] 初始化失败，云端功能降级为仅本地', e)
    }
    // 本地文件清扫：USER_DATA_PATH 下只增不减会在写满 200MB 后导致导出失败
    // （平台不自动清理）。异步执行、静默失败，不影响启动。
    try {
      require('./utils/cache').sweepAll().catch(() => {})
    } catch (e) {
      console.warn('[cache] 清扫失败', e)
    }
    this._sync()
  },

  // 热启动（从后台切回）也补一次同步：上次可能因断网失败，而失败不该只在下次冷启动才重试。
  // 节流在 utils/sync.js 内部（距上次同步成功不足 5 分钟则跳过），不会反复打网络。
  onShow() {
    this._sync()
  },

  _sync() {
    // 用户数据上云（模板 / 收藏 / 最近生成 / 打印历史 / 累计张数）
    try {
      require('./utils/sync').bootstrap().catch(() => {})
    } catch (e) {
      console.warn('[sync] 启动同步失败', e)
    }
  },
})
