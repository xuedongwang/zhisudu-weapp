// pages/history/history.js
// 打印历史（FR-16）：每次导出成功各记一条，上限 50；顶部给出累计张数与常用纸型。
//
// 与首页「最近生成」的区别（两者并存，不是重复功能）：
//   最近生成 —— 同配置去重、上限 10，是「参数复用快捷入口」，服务于"再印一张一样的"
//   打印历史 —— 每次各记一条、上限 50，是「行为流水」，服务于"我印过什么"的沉淀与统计
// 首页「最近生成」区块右上角提供本页入口。

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const sync = require('../../utils/sync')
const thumbs = require('../../utils/thumbs')
const track = require('../../utils/track')

// 相对时间：今天/昨天带时刻，同年只到月日，跨年带年份
function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const yest = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

Page({
  data: {
    history: [], // [{id, type, title, sub, timeText, params, thumb}]
    total: 0,    // 累计导出张数（真实值，不受列表 50 条截断影响）
    kept: 0,     // 列表中保留的条数
    topText: '', // 常用纸型（前 3）
    limitNum: store.HISTORY_LIMIT,
  },

  onShow() {
    track.pageView('history')
    this._refresh()
    // 跨设备历史要立刻可见（同步在 app.onLaunch 发起，晚于本页渲染）
    this._offSync = sync.onSynced(() => this._refresh())
  },

  onHide() {
    this._unwatchSync()
  },

  onUnload() {
    this._unwatchSync()
  },

  _unwatchSync() {
    if (this._offSync) {
      this._offSync()
      this._offSync = null
    }
  },

  _refresh() {
    const stats = store.getHistoryStats()
    const list = store.getHistory().map((h) => {
      // v1.5 批量记录：一条流水代表「一套」，缩略图用第一张，文案含成功张数
      if (h.batch) {
        const names = []
        h.items.forEach((p) => {
          const n = (papers.PAPERS[p.blocks[0].type] || {}).name || p.blocks[0].type
          if (names.indexOf(n) < 0) names.push(n)
        })
        return {
          id: h.id,
          batch: true,
          items: h.items,
          type: '__batch__',
          params: h.items[0],
          title: `批量一套 · ${h.count} 张`,
          sub: `${names.join(' · ')} · ${fmtTime(h.time)}`,
          thumb: '',
        }
      }
      // 整页文案（含规格/版式/多区块）统一由 papers.describePage 生成
      const d = papers.describePage(h.params)
      return {
        id: h.id,
        type: h.params.blocks[0].type,
        params: h.params,
        title: d.title,
        sub: `${d.sub} · ${fmtTime(h.time)}`,
        thumb: '',
      }
    })
    this.setData({
      history: list,
      total: stats.total,
      kept: stats.kept,
      topText: stats.byType.slice(0, 3).map((t) => `${t.name} ${t.count} 张`).join(' · '),
    })
    list.forEach((item, idx) => {
      thumbs.ensurePageThumb(item.params).then((path) => {
        if (path) this.setData({ [`history[${idx}].thumb`]: path })
      })
    })
  },

  // 按某条历史「再来一张」：带完整整页参数直达配置页，source=history 用于区分它与首页最近记录
  reuse(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.history[idx]
    if (!item) return
    // v1.5 批量记录：整套带去批量导出页（参数可能很长，走 globalData 不走 URL）
    if (item.batch) {
      track.report('paper_select', { paper_type: '__batch__', source: 'history' })
      getApp().globalData.batchSeed = item.items
      wx.navigateTo({ url: '/pages/batch/batch?seed=1' })
      return
    }
    track.report('paper_select', { paper_type: item.type, source: 'history' })
    track.report('template_reuse', { paper_type: item.type })
    const params = encodeURIComponent(JSON.stringify(item.params))
    wx.navigateTo({ url: `/pages/config/config?type=${item.type}&params=${params}` })
  },

  // 清空历史：不可恢复，二次确认（危险色）
  clearAll() {
    wx.showModal({
      title: '清空打印历史',
      content: '将删除全部历史记录与累计张数（云端与本机同时清除），不可恢复。已保存的模板与收藏不受影响。',
      confirmText: '清空',
      confirmColor: '#D9534F',
      success: (res) => {
        if (!res.confirm) return
        store.clearHistory()
        this._refresh()
        wx.showToast({ title: '已清空', icon: 'none' })
      },
    })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  // v1.5 批量导出入口
  goBatch() {
    wx.navigateTo({ url: '/pages/batch/batch' })
  },
})
