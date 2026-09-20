// pages/success/success.js
// 导出成功页：发到电脑（主按钮）/ 保存到相册 / 打印指引（PRD FR-06/07）

const papers = require('../../utils/papers')

Page({
  data: {
    tempPath: '',
    meta: '',
    downgraded: false,
    saving: false,
  },

  onLoad() {
    const app = getApp()
    const result = app.globalData.exportResult
    if (!result || !result.tempPath) {
      wx.showToast({ title: '没有可展示的导出结果', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 800)
      return
    }
    const p = papers.PAPERS[result.params.type]
    const orient = result.params.orient === 'l' ? '横向' : '纵向'
    this.setData({
      tempPath: result.tempPath,
      downgraded: !!result.downgraded,
      meta: `${p.name} · A4 ${orient} · ${result.dpi}DPI · ${result.widthPx}×${result.heightPx}`,
    })
  },

  // 发到电脑：拉起微信图片转发面板，可选「文件传输助手」（FR-07，最快打印路径）
  onSendToPC() {
    wx.showShareImageMenu({
      path: this.data.tempPath,
      fail: (err) => {
        // 用户取消属正常操作，静默；其他错误提示
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '转发面板拉起失败', icon: 'none' })
        }
      },
    })
  },

  // 保存到相册（含授权拒绝引导，PRD FR-12.1 / EX-01）
  onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.saveImageToPhotosAlbum({
      filePath: this.data.tempPath,
      success: () => {
        this.setData({ saving: false })
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        this.setData({ saving: false })
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') > -1) return // 用户取消保存，静默
        if (
          msg.indexOf('auth deny') > -1 ||
          msg.indexOf('auth refuse') > -1 ||
          msg.indexOf('authorize') > -1
        ) {
          wx.showModal({
            title: '需要相册写入权限',
            content: '保存图片需要授予「添加到相册」权限，是否前往设置开启？',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            },
          })
        } else {
          wx.showToast({ title: '保存失败：' + msg, icon: 'none' })
        }
      },
    })
  },

  onDone() {
    wx.switchTab({ url: '/pages/home/home' })
  },
})
