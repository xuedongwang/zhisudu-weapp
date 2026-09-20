// pages/mine/mine.js
// 我的：用户资料（头像昵称，云端同步）+ 模板管理（套用/删除，FR-09）+ 收藏/关于/客服

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const thumbs = require('../../utils/thumbs')
const cloudUtil = require('../../utils/cloud')
const { ICONS } = require('../../utils/icons')

Page({
  data: {
    icons: ICONS,
    profile: { avatar: '', nickname: '' },
    templates: [],
    favCount: 0,
    tplLimit: store.TEMPLATE_LIMIT,
    cloudReady: false,
  },

  onShow() {
    this.setData({
      cloudReady: getApp().globalData.cloudReady,
      favCount: store.getFavs().length,
    })
    this._refreshTemplates()
    // 用户资料：本地优先展示，云端异步补齐
    cloudUtil.loadProfile((profile) => {
      this.setData({ profile: { avatar: profile.avatar || '', nickname: profile.nickname || '' } })
    })
  },

  // ---------- 用户资料（官方合规组件：chooseAvatar + 昵称输入） ----------
  onChooseAvatar(e) {
    const avatar = e.detail.avatarUrl
    this._saveProfile({ avatar })
  },
  onNickname(e) {
    const nickname = (e.detail.value || '').trim()
    this._saveProfile({ nickname })
  },
  _saveProfile(patch) {
    const cur = this.data.profile
    cloudUtil.saveProfile({ ...cur, ...patch }).then((saved) => {
      this.setData({ profile: { avatar: saved.avatar, nickname: saved.nickname } })
      wx.showToast({ title: '已保存', icon: 'none' })
    })
  },

  // ---------- 模板 ----------
  _refreshTemplates() {
    const tpls = store.getTemplates().map((t) => {
      const p = papers.PAPERS[t.type]
      const parts = [p.cell.label + t.params.cell + 'mm']
      if (p.hasCols) parts.push(t.params.cols + ' 栏')
      parts.push(t.params.orient === 'l' ? '横向' : '纵向')
      return { ...t, paperName: p.name, desc: parts.join(' · '), thumb: '' }
    })
    this.setData({ templates: tpls })
    tpls.forEach((item, idx) => {
      thumbs.ensureThumb(item.type).then((path) => {
        if (path) this.setData({ [`templates[${idx}].thumb`]: path })
      })
    })
  },

  applyTpl(e) {
    const { id, type } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/config/config?type=${type}&tpl=${id}` })
  },

  deleteTpl(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除模板',
      content: '删除后不可恢复，确定删除该模板吗？',
      confirmColor: '#D9534F',
      success: (res) => {
        if (res.confirm) {
          store.deleteTemplate(id)
          this._refreshTemplates()
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      },
    })
  },

  // ---------- 入口 ----------
  goFavs() {
    wx.navigateTo({ url: '/pages/favs/favs' })
  },
  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },
})
