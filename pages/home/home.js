// pages/home/home.js
// 首页：收藏置顶 + 纸型分类分组 + 最近生成记录（PRD FR-01/10/11/17/18）
//
// v1.1：纸型从 8 种增至 12 种，原先把所有纸型塞进一个标题写死的「儿童场景纸」区块已不成立
//（新增了坐标纸、五线谱、康奈尔笔记、周计划等中学与成人向纸型），改为按 papers.CATEGORIES 分组。

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const sync = require('../../utils/sync')
const thumbs = require('../../utils/thumbs')
const track = require('../../utils/track')

Page({
  data: {
    favs: [],      // 收藏的纸型 [{key, name}]
    groups: [],    // 纸型分类 [{key, name, papers:[{key,name,desc,thumb}]}]
    total: 0,      // 纸型总数
    recent: [],    // 最近记录 [{params, type, title, desc, thumb}]
    hisTotal: 0,   // 累计导出张数（打印历史页同源，用于区块标题右侧与入口）
  },

  onShow() {
    track.pageView('home')
    this._buildPapers()
    this._refreshData()
    // 云端拉回来的收藏与最近记录要**立刻**可见：同步在 app.onLaunch 发起，
    // 返回时间晚于本页首次渲染，所以注册一次「同步完成」回调重读
    this._offSync = sync.onSynced(() => this._refreshData())
  },

  onHide() {
    this._unwatchSync()
  },

  onUnload() {
    this._unwatchSync()
  },

  // 取消同步回调：避免回调落在已隐藏/已卸载的页面上
  _unwatchSync() {
    if (this._offSync) {
      this._offSync()
      this._offSync = null
    }
  },

  // 收藏行 + 最近记录 + 累计张数三处同源本机数据，一处刷新即可覆盖
  _refreshData() {
    this._buildFavs()
    this._buildRecent()
    this.setData({ hisTotal: store.getHistoryStats().total })
  },

  // 纸型卡片：按分类分组，缩略图异步生成后回填
  _buildPapers() {
    const groups = papers.groupedPapers()
    this.setData({
      groups,
      total: groups.reduce((n, g) => n + g.papers.length, 0),
    })
    groups.forEach((g, gi) => {
      g.papers.forEach((item, pi) => {
        thumbs.ensureThumb(item.key).then((path) => {
          if (path) this.setData({ [`groups[${gi}].papers[${pi}].thumb`]: path })
        })
      })
    })
  },

  // 收藏置顶行
  _buildFavs() {
    const favKeys = store.getFavs()
    this.setData({
      favs: favKeys.filter((k) => papers.PAPERS[k]).map((k) => ({ key: k, name: papers.PAPERS[k].name })),
    })
  },

  // 最近生成记录（最多 10 条）：整页参数复用入口，支持多区块版面
  _buildRecent() {
    const list = store.getRecent().map((r) => {
      // v1.5 批量记录：一张卡片代表「一套」，缩略图用第一张，文案列出去重后的纸型
      if (r.batch) {
        const names = []
        r.items.forEach((p) => {
          const n = (papers.PAPERS[p.blocks[0].type] || {}).name || p.blocks[0].type
          if (names.indexOf(n) < 0) names.push(n)
        })
        return {
          batch: true,
          items: r.items,
          params: r.items[0], // 缩略图用整套的第一张
          type: '__batch__',
          title: `批量一套 · ${r.count} 张`,
          desc: names.join(' · '),
          thumb: '',
        }
      }
      const d = papers.describePage(r.params)
      return {
        params: r.params,
        type: r.params.blocks[0].type,
        title: d.title,
        // 描述从原先与时间拼接的 sub 整串里拆出来单独成字段：拼好的一整串只能整行平铺，
        // 长文案会一路顶到按钮；独立字段配合单行 ellipsis 自我收敛
        desc: d.sub,
        thumb: '',
      }
    })
    this.setData({ recent: list })
    list.forEach((item, idx) => {
      thumbs.ensurePageThumb(item.params).then((path) => {
        if (path) this.setData({ [`recent[${idx}].thumb`]: path })
      })
    })
  },

  // 长按纸型卡片 → 收藏/取消收藏（FR-11：收藏纸型首页置顶）
  onPaperLongPress(e) {
    const type = e.currentTarget.dataset.type
    wx.vibrateShort({ type: 'light' })
    store.toggleFav(type)
    const on = store.isFav(type)
    wx.showToast({ title: on ? `已收藏「${papers.PAPERS[type].name}」` : '已取消收藏', icon: 'none' })
    this._buildFavs()
  },

  openConfig(e) {
    const type = e.currentTarget.dataset.type
    const source = e.currentTarget.dataset.source || 'group'
    track.report('paper_select', { paper_type: type, source })
    wx.navigateTo({ url: `/pages/config/config?type=${type}` })
  },

  // 最近记录一键复用（携带完整整页参数，多区块版面也能还原）
  reuseRecent(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.recent[idx]
    if (!item) return
    // v1.5 批量记录：整套带去批量导出页（参数可能很长，走 globalData 不走 URL）
    if (item.batch) {
      track.report('paper_select', { paper_type: '__batch__', source: 'recent' })
      getApp().globalData.batchSeed = item.items
      wx.navigateTo({ url: '/pages/batch/batch?seed=1' })
      return
    }
    track.report('paper_select', { paper_type: item.type, source: 'recent' })
    track.report('template_reuse', { paper_type: item.type })
    const params = encodeURIComponent(JSON.stringify(item.params))
    wx.navigateTo({ url: `/pages/config/config?type=${item.type}&params=${params}` })
  },

  // 打印历史（FR-16）：本区块只列最近 10 条参数复用，完整流水与累计张数在历史页
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  // v1.5 批量导出入口（最近生成区块标题右侧）
  goBatch() {
    wx.navigateTo({ url: '/pages/batch/batch' })
  },

  // 转发卡片（FR-15）：不定义时微信会退回「页面截图 + 页面标题」，卡片不可控。
  // 此处只定义「发送给好友」；朋友圈（onShareTimeline）打开的是单页模式，
  // 该模式下 tabBar 与 navigateTo 均不可用，首页会变成"点不动的死页"，故本期不做。
  onShareAppMessage() {
    track.report('share_click', { page_name: 'home' })
    return {
      title: '纸速打 · 免费打印田字格 / 米字格 / 口算纸 / 笔记纸',
      path: '/pages/home/home',
    }
  },
})
