// app.js
App({
  globalData: {
    // 导出结果（config 页生成后传入 success 页），避免通过 URL 传长路径
    exportResult: null,
    // 云开发可用状态
    cloudReady: false,
  },
  onLaunch() {
    // 初始化云开发（默认环境；需在开发者工具开通云开发并创建 users 集合）
    try {
      if (wx.cloud) {
        wx.cloud.init({
          traceUser: true,
          // env 不传 = 使用默认环境
        })
        this.globalData.cloudReady = true
      }
    } catch (e) {
      console.warn('[cloud] 初始化失败，云端功能降级为仅本地', e)
    }
  },
})
