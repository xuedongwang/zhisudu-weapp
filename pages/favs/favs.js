// pages/favs/favs.js
// 我的收藏：收藏纸型列表，点击进入配置，可取消收藏（FR-11）

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const thumbs = require('../../utils/thumbs')

Page({
  data: {
    favs: [],
  },

  onShow() {
    this._refresh()
  },

  _refresh() {
    const favs = store.getFavs()
      .filter((k) => papers.PAPERS[k])
      .map((k) => ({ key: k, name: papers.PAPERS[k].name, desc: papers.PAPERS[k].desc, thumb: '' }))
    this.setData({ favs })
    favs.forEach((item, idx) => {
      thumbs.ensureThumb(item.key).then((path) => {
        if (path) this.setData({ [`favs[${idx}].thumb`]: path })
      })
    })
  },

  openConfig(e) {
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: `/pages/config/config?type=${type}` })
  },

  removeFav(e) {
    const type = e.currentTarget.dataset.type
    store.toggleFav(type)
    this._refresh()
    wx.showToast({ title: '已取消收藏', icon: 'none' })
  },
})
