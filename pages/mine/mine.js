// pages/mine/mine.js
// 我的：用户资料（头像昵称，云端同步）+ 模板管理（套用/删除，FR-09）+ 收藏/关于/客服

const store = require('../../utils/store')
const sync = require('../../utils/sync')
const thumbs = require('../../utils/thumbs')
const cloudUtil = require('../../utils/cloud')
const track = require('../../utils/track')
const { ICONS } = require('../../utils/icons')
const { CURRENT_VERSION } = require('../../utils/version')

// 清除资料失败的四种情形 → 给用户看得懂的话 + 可执行的下一步。
// 口径：**只说事实，不谎报成功**——删除失败却提示「已清除」，等于把一个合规问题
// 变成用户永远发现不了的问题。文案统一给出「重试」与「联系客服」两条出路。
const CLEAR_FAIL_TEXT = {
  cloud_unreachable: '当前无法连接云端，云端资料未能删除。请检查网络后重试；若持续失败，可通过「联系客服」申请删除。',
  cloud_query_failed: '云端资料读取失败，无法确认是否已删除，因此本机资料也为你保留。请稍后重试；若持续失败，可通过「联系客服」申请删除。',
  cloud_file_delete_failed: '云端头像文件删除失败，本机资料已为你保留。请稍后重试；若持续失败，可通过「联系客服」申请删除。',
  cloud_doc_delete_failed: '云端资料记录删除失败，本机资料已为你保留。请稍后重试；若持续失败，可通过「联系客服」申请删除。',
}

Page({
  data: {
    icons: ICONS,
    profile: { avatar: '', nickname: '' },
    templates: [],
    favCount: 0,
    hisTotal: 0,   // 累计导出张数（打印历史页同源）
    tplLimit: store.TEMPLATE_LIMIT,
    cloudReady: false,   // 云能力是否初始化（环境层面）
    cloudSynced: false,  // 资料是否真的读到了云端记录（事实层面，UI 标签以此为准）
    appVersion: CURRENT_VERSION,
  },

  onShow() {
    track.pageView('mine')
    this._refreshData()
    // 用户资料：本地优先展示，云端异步补齐（可能回调两次，以最后一次为准）；
    // 头像+昵称填齐后锁定——头像是本机路径且文件已失效时不锁定，允许用户重设
    cloudUtil.loadProfile((profile, meta) => {
      const p = { avatar: profile.avatar || '', nickname: profile.nickname || '' }
      this._profileSynced = !!(meta && meta.synced)
      this.setData({
        profile: p,
        profileLocked: this._isLocked(p),
        cloudSynced: this._syncLabel(),
      })
    })
    // 模板 / 收藏 / 累计张数的跨设备同步要立刻可见
    this._offSync = sync.onSynced(() => this._refreshData())
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

  /**
   * 同步标签口径（v1.2.0 起）：**资料与用户数据都同步成功**才显示「已同步云端」。
   * 只看资料会漏掉「模板/历史其实没上去」这一种——那正是 v1.1.2 修掉的「假绿」思路，
   * 数据上云后又多了一个可能失真的来源，索性一起纳入判据。
   * 用户从未设置过头像昵称时，不把「资料未同步」算作失败（没有资料可同步）。
   */
  _syncLabel() {
    if (!getApp().globalData.cloudReady) return false
    const dataOk = !!sync.syncState().ok
    const hasProfile = !!(this.data.profile.avatar || this.data.profile.nickname)
    const profileOk = hasProfile ? !!this._profileSynced : true
    return !!(dataOk && profileOk)
  },

  // 模板列表 + 收藏数 + 累计张数：同步完成后重读同一批本机数据
  _refreshData() {
    this.setData({
      cloudReady: getApp().globalData.cloudReady,
      favCount: store.getFavs().length,
      hisTotal: store.getHistoryStats().total,
      cloudSynced: this._syncLabel(),
    })
    this._refreshTemplates()
  },

  // ---------- 用户资料（官方合规组件：chooseAvatar + 昵称输入；填齐后锁定不可改） ----------
  _isLocked(p) {
    return !!(p && p.avatar && p.nickname)
  },
  onChooseAvatar(e) {
    // 防御：已锁定时 UI 上按钮已隐藏，此处兜底拦截
    if (this.data.profileLocked) return
    const avatar = e.detail.avatarUrl
    this._saveProfile({ avatar })
  },
  onNickname(e) {
    if (this.data.profileLocked) return
    const nickname = (e.detail.value || '').trim()
    this._saveProfile({ nickname })
  },
  _saveProfile(patch) {
    const cur = this.data.profile
    cloudUtil.saveProfile({ ...cur, ...patch }).then((saved) => {
      const p = { avatar: saved.avatar, nickname: saved.nickname }
      this._profileSynced = !!saved.synced
      this.setData({
        profile: p,
        profileLocked: this._isLocked(p),
        cloudSynced: this._syncLabel(),
      })
      // toast 说实话：云端写失败（集合缺失/权限错/无网）时不能让用户以为已备份
      wx.showToast({ title: saved.synced ? '已保存并同步到云端' : '已保存到本机', icon: 'none' })
    })
  },

  // ---------- 清除我的资料（v1.1.3，合规：为用户提供删除个人信息的途径） ----------
  // 范围仅限「头像 + 昵称」；模板 / 收藏 / 打印历史**不在删除范围内**，
  // 确认弹窗里必须写清楚，否则用户会以为整个小程序的数据都没了。
  // v1.2.0 补充：这三类数据也已上云（独立集合 userdata，见 utils/sync.js），
  // 所以文案要把「本机与云端都不清」说全，删不动的地方不能装作删得动。
  clearMyProfile() {
    wx.showModal({
      title: '清除我的资料',
      content: '将删除你的头像与昵称（云端与本机同时清除），删除后不可恢复、也不会再自动恢复。模板、收藏与打印历史会保留（本机与云端均不清除），如需删除请使用各功能内的删除入口。',
      confirmText: '清除',
      confirmColor: '#D9534F',
      success: (res) => {
        if (res.confirm) this._doClearProfile()
      },
    })
  },

  _doClearProfile() {
    wx.showLoading({ title: '正在清除', mask: true })
    cloudUtil.clearProfile().then((r) => {
      wx.hideLoading()
      if (!r.ok) {
        wx.showModal({
          title: '未能清除',
          content: CLEAR_FAIL_TEXT[r.reason] || '清除失败，请稍后重试；若持续失败，可通过「联系客服」申请删除。',
          showCancel: false,
          confirmText: '知道了',
        })
        return
      }
      // 清除成功后资料回到未填状态 → 解锁（可重新设置）
      this._profileSynced = false
      this.setData({ profile: { avatar: '', nickname: '' }, profileLocked: false })
      // 资料清空后标签要重算：模板/历史仍可能同步正常，不该跟着一起显示「仅本机保存」
      this._refreshData()
      wx.showToast({ title: r.cloudDeleted ? '已清除云端与本机资料' : '已清除本机资料', icon: 'none' })
    })
  },

  // ---------- 模板 ----------
  _refreshTemplates() {
    // 按当前命名规则重算存量模板名称（幂等），再生成两行展示文案
    const tpls = store.syncTemplateNames().map((t) => {
      const d = store.describeTemplate(t.params)
      return { ...t, title: d.title, sub: d.sub, thumb: '' }
    })
    this.setData({ templates: tpls })
    tpls.forEach((item, idx) => {
      // 缩略图按整页参数生成：多区块版面能显示出版面结构，单区块退化为该纸型的图
      thumbs.ensurePageThumb(item.params).then((path) => {
        if (path) this.setData({ [`templates[${idx}].thumb`]: path })
      })
    })
  },

  applyTpl(e) {
    const { id, type } = e.currentTarget.dataset
    track.report('template_reuse', { paper_type: type })
    track.report('paper_select', { paper_type: type, source: 'template' })
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
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },
  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },
})
