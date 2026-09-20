// pages/home/home.js
// 首页：收藏置顶 + 儿童场景纸分组 + 最近生成记录（PRD FR-01/10/11）

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const thumbs = require('../../utils/thumbs')

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    favs: [],      // 收藏的纸型 [{key, name}]
    papers: [],    // 8 种纸型 [{key, name, desc, thumb}]
    recent: [],    // 最近记录 [{type, name, desc, timeText, thumb, params}]
  },

  onShow() {
    this._buildPapers()
    this._buildFavs()
    this._buildRecent()
  },

  // 8 种纸型卡片（缩略图异步生成后回填）
  _buildPapers() {
    const list = Object.keys(papers.PAPERS).map((key) => {
      const p = papers.PAPERS[key]
      return { key, name: p.name, desc: p.desc, thumb: '' }
    })
    this.setData({ papers: list })
    list.forEach((item, idx) => {
      thumbs.ensureThumb(item.key).then((path) => {
        if (path) this.setData({ [`papers[${idx}].thumb`]: path })
      })
    })
  },

  // 收藏置顶行
  _buildFavs() {
    const favKeys = store.getFavs()
    this.setData({
      favs: favKeys.map((key) => ({ key, name: papers.PAPERS[key].name })),
    })
  },

  // 最近生成记录（最多 10 条）
  _buildRecent() {
    const list = store.getRecent().map((r) => {
      const p = papers.PAPERS[r.type]
      const parts = [p.cell.label + r.params.cell + 'mm']
      if (p.hasCols) parts.push(r.params.cols + ' 栏')
      parts.push(r.params.orient === 'l' ? '横向' : '纵向')
      return {
        type: r.type,
        params: r.params,
        name: p.name,
        desc: parts.join(' · '),
        timeText: fmtTime(r.time),
        thumb: '',
      }
    })
    this.setData({ recent: list })
    list.forEach((item, idx) => {
      thumbs.ensureThumb(item.type).then((path) => {
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
    wx.navigateTo({ url: `/pages/config/config?type=${type}` })
  },

  // 最近记录一键复用（携带完整参数）
  reuseRecent(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.recent[idx]
    if (!item) return
    const params = encodeURIComponent(JSON.stringify(item.params))
    wx.navigateTo({ url: `/pages/config/config?type=${item.type}&params=${params}` })
  },
})
