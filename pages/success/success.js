// pages/success/success.js
// 导出成功页：分享（主按钮）/ 保存到相册 / 打印指引（PRD FR-06/07）

const papers = require('../../utils/papers')
const track = require('../../utils/track')

Page({
  data: {
    type: '',
    tempPath: '',
    meta: '',
    sizeName: 'A4',
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
    // result.params 已是归一化整页参数（含 size/layout/blocks），单区块与多区块统一走 describePage
    const d = papers.describePage(result.params)
    const type = result.params.blocks[0].type
    track.pageView('success')
    this.setData({
      type,
      tempPath: result.tempPath,
      sizeName: d.size.name,
      downgraded: !!result.downgraded,
      meta: `${d.title} · ${d.sub} · ${result.dpi}DPI · ${result.widthPx}×${result.heightPx}`,
    })
    this._checkFile(result.tempPath)
  },

  // 校验导出文件确实已写盘（分享与保存都依赖它）。
  // 只做诊断与提示：分享面板读不到图片时，先排除「文件不存在 / 为空」这一层原因。
  _checkFile(path) {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: (res) => {
        console.log('[success] 导出文件大小', res.size, 'bytes')
        if (!res.size) {
          wx.showToast({ title: '图片文件异常，建议返回重新导出', icon: 'none' })
        }
      },
      fail: (e) => console.warn('[success] 导出文件校验失败', e),
    })
  },

  // 分享（FR-07）：拉起微信图片分享面板——官方描述为「可以将图片发送给朋友、分享至朋友圈、
  // 收藏或下载」。其中「发送给朋友 → 文件传输助手」是最快的打印路径。
  // 注意：分享失败必须暴露真实 errMsg，否则无法定位（工具不支持 / 路径问题 / 基础库过低都会 fail）。
  onShare() {
    const path = this.data.tempPath
    track.report('export_click', { paper_type: this.data.type, action: 'file' })
    if (!path) {
      wx.showModal({
        title: '图片未就绪',
        content: '请返回配置页重新导出后再分享',
        showCancel: false,
      })
      return
    }
    wx.showShareImageMenu({
      path,
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        // 用户取消属正常操作，静默（面板已弹出即说明调用成功）
        if (msg.indexOf('cancel') > -1) return
        track.exportFail(this.data.type, err)
        wx.showModal({
          title: '分享面板拉起失败',
          content: `${msg || '未知原因'}\n\n可改用「保存到相册」，再从相册分享给朋友或文件传输助手。`,
          showCancel: false,
        })
      },
    })
  },

  // 保存到相册（含授权拒绝引导，PRD FR-12.1 / EX-01）
  onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    track.report('export_click', { paper_type: this.data.type, action: 'album' })
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
        track.exportFail(this.data.type, err)
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

  // 转发卡片（FR-15）：带上刚生成的完整整页参数，好友点开就是同一张纸（多区块版面一并还原）。
  // 与「分享」主按钮的区别要说清楚——主按钮分享的是**图片**（showShareImageMenu），
  // 这里分享的是**小程序页面**（聊天卡片），两条路径互不替代。
  onShareAppMessage() {
    const result = getApp().globalData.exportResult
    const raw = result && result.params
    const n = raw ? papers.normalizeParams(raw) : null
    const type = n ? n.blocks[0].type : this.data.type
    const p = papers.PAPERS[type]
    track.report('share_click', { page_name: 'success', paper_type: type })

    let path = '/pages/home/home'
    // from=share 与配置页分享保持同一约定：只要落地页是配置页就带上，
    // 好友点开后才会出现承接提示条并上报 source=share（指向首页时不带）
    if (n) {
      const encoded = encodeURIComponent(JSON.stringify(n))
      path = `/pages/config/config?type=${type}&params=${encoded}&from=share`
    } else if (type) {
      path = `/pages/config/config?type=${type}&from=share`
    }

    const title = n && n.layout !== '1x1'
      ? `我用纸速打配好了一张${papers.findLayout(n.layout).name}，点开就能打印`
      : (p ? `我用纸速打生成了${p.name}，免费无水印` : '纸速打 · 免费打印练习纸')

    return { title, path }
  },
})
