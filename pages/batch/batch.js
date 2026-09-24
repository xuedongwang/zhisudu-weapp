// pages/batch/batch.js
// 批量导出（v1.5）：从最近生成 / 打印历史多选，一次生成一套（最多 9 张）。
//
// 已确认的设计口径：
//   · 入口 = 最近/历史多选；顺序 = **按列表顺序**（相册保存序 = 打印店交付序）
//   · 记录 = 一条批量记录（最近生成与打印历史各一条，不是 N 条，见 store.js）
//   · 失败 = 显式列出失败项 +「重试失败的 k 张」；**任何环节部分失败都不得显示「完成」**（RK-14）
//
// 硬约束（API 决定）：
//   · 生成必须**串行**——export 文件名带 Date.now()，Promise.all 会同毫秒撞名互相覆盖，
//     且 N 页同时驻留内存峰值不可控；逐张「绘制 → 导出 → 释放」天然规避
//   · wx.saveImageToPhotosAlbum 是单文件 API，「全部存相册」只能循环逐张保存
//   · 每张生成都经过 exporter 的读回校验两道（非空白抽查，全空白纸型豁免），无需另做

const papers = require('../../utils/papers')
const store = require('../../utils/store')
const exporter = require('../../utils/exporter')
const thumbs = require('../../utils/thumbs')
const cache = require('../../utils/cache')
const track = require('../../utils/track')
const { LIMITS } = require('../../utils/schema')

const BATCH_MAX = LIMITS.batch // 9

Page({
  data: {
    mode: 'pick',       // pick 勾选 → result 结果
    entries: [],        // 可勾选项 [{key,title,sub,items,picked,thumb,fromBatch}]
    selCount: 0,        // 已选张数（按 items 展开计）
    batchMax: BATCH_MAX,
    seeded: false,      // 是否由「再来一套」带入
    // ---- 结果态 ----
    results: [],        // [{params,title,ok,tempPath,error,saved,saveFail}]
    running: false,     // 生成中（首轮或重试）
    progress: '',
    saving: false,      // 相册保存中
    okCount: 0,
    failCount: 0,
  },

  onLoad(options) {
    track.pageView('batch')
    // 「再来一套」：从最近/历史的批量记录带入整套参数（走 globalData，不走 URL——
    // 9 张完整参数 JSON 远超 navigateTo 的 URL 长度上限）
    const app = getApp()
    if (options.seed && app.globalData.batchSeed && app.globalData.batchSeed.length) {
      this._seedItems = app.globalData.batchSeed.map((p) => papers.normalizeParams(p))
      app.globalData.batchSeed = null
      this.setData({ seeded: true })
    }
    this._build()
  },

  // ---------- 勾选态 ----------

  // 候选 = 最近生成（≤10）+ 打印历史（≤20），批量记录按整套一项参与勾选；
  // 两处同套的按签名去重（最近生成在前，优先保留）
  _build() {
    const seen = {}
    const entries = []
    const push = (items, time) => {
      const norm = items.map((p) => papers.normalizeParams(p))
      const sig = papers.batchSignature(norm)
      if (seen[sig]) return
      seen[sig] = 1
      const first = papers.describePage(norm[0])
      if (norm.length === 1) {
        const d = first
        entries.push({ key: sig, title: d.title, sub: d.sub, items: norm, picked: false, thumb: '' })
      } else {
        const names = []
        norm.forEach((p) => {
          const n = (papers.PAPERS[p.blocks[0].type] || {}).name || p.blocks[0].type
          if (names.indexOf(n) < 0) names.push(n)
        })
        entries.push({ key: sig, title: `批量一套 · ${norm.length} 张`, sub: names.join(' · '), items: norm, picked: false, thumb: '' })
      }
    }
    store.getRecent().forEach((r) => push(r.batch ? r.items : [r.params], r.time))
    store.getHistory().slice(0, 20).forEach((h) => push(h.batch ? h.items : [h.params], h.time))

    // 种子项置顶并默认勾选（若与候选同套，直接勾选该项）
    if (this._seedItems && this._seedItems.length) {
      const sig = papers.batchSignature(this._seedItems)
      const hit = entries.find((e) => e.key === sig)
      if (hit) {
        hit.picked = true
      } else {
        const names = []
        this._seedItems.forEach((p) => {
          const n = (papers.PAPERS[p.blocks[0].type] || {}).name || p.blocks[0].type
          if (names.indexOf(n) < 0) names.push(n)
        })
        entries.unshift({
          key: sig,
          title: this._seedItems.length === 1 ? papers.describePage(this._seedItems[0]).title : `批量一套 · ${this._seedItems.length} 张`,
          sub: names.join(' · '),
          items: this._seedItems,
          picked: true,
          thumb: '',
        })
      }
    }

    this.setData({ entries }, () => this._recount())
    entries.forEach((item, idx) => {
      thumbs.ensurePageThumb(item.items[0]).then((path) => {
        if (path) this.setData({ [`entries[${idx}].thumb`]: path })
      })
    })
  },

  _recount() {
    const selCount = this.data.entries.reduce((n, e) => n + (e.picked ? e.items.length : 0), 0)
    this.setData({ selCount })
  },

  toggle(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.entries[idx]
    if (!item) return
    if (!item.picked) {
      const after = this.data.selCount + item.items.length
      if (after > BATCH_MAX) {
        wx.showToast({ title: `一套最多 ${BATCH_MAX} 张`, icon: 'none' })
        return
      }
    }
    this.setData({ [`entries[${idx}].picked`]: !item.picked }, () => this._recount())
  },

  // ---------- 生成（串行，禁 Promise.all） ----------

  async start() {
    if (this.data.running) return
    const all = []
    this.data.entries.forEach((e) => {
      if (e.picked) e.items.forEach((p) => all.push(p))
    })
    if (!all.length) {
      wx.showToast({ title: '先勾选要一起打的纸', icon: 'none' })
      return
    }
    this.setData({ running: true, mode: 'result', results: [], progress: `0/${all.length}` })
    const t0 = Date.now()
    const results = []
    for (let i = 0; i < all.length; i++) {
      this.setData({ progress: `正在生成 ${i + 1}/${all.length}` })
      const title = papers.describePage(all[i]).title
      try {
        const r = await exporter.generateImage(all[i])
        results.push({ params: all[i], title, ok: true, tempPath: r.tempPath, error: '', saved: false, saveFail: false })
      } catch (err) {
        results.push({ params: all[i], title, ok: false, tempPath: '', error: (err && err.message) || '生成失败', saved: false, saveFail: false })
      }
    }
    const okCount = results.filter((r) => r.ok).length
    // 记录口径：一条批量记录（全败不记——什么都没生成出来，记了也是假数据）
    if (okCount > 0) {
      store.pushBatchRecent(all)
      this._hisId = store.pushBatchHistory(all, okCount)
      track.report('export_success', { paper_type: '__batch__', dpi: 0, duration_ms: Date.now() - t0 })
    } else {
      track.exportFail('__batch__', new Error('批量生成全部失败'))
    }
    cache.sweepExports().catch(() => {})
    this.setData({
      running: false,
      results,
      okCount,
      failCount: all.length - okCount,
      progress: '',
    })
  },

  // 「重试失败的 k 张」：只重试失败项，成功项不动；追加张数记进**同一条**批量历史
  async retryFailed() {
    if (this.data.running) return
    const failIdx = this.data.results.map((r, i) => (!r.ok ? i : -1)).filter((i) => i >= 0)
    if (!failIdx.length) return
    this.setData({ running: true, progress: `重试 ${failIdx.length} 张` })
    let newOk = 0
    for (const i of failIdx) {
      const r = this.data.results[i]
      try {
        const res = await exporter.generateImage(r.params)
        this.setData({ [`results[${i}]`]: { ...r, ok: true, tempPath: res.tempPath, error: '', saved: false, saveFail: false } })
        newOk++
      } catch (err) {
        this.setData({ [`results[${i}].error`]: (err && err.message) || '生成失败' })
      }
    }
    if (newOk > 0) {
      if (this._hisId) {
        store.bumpBatchHistory(this._hisId, newOk)
      } else {
        // 首轮全败未记录：重试出第一张成功时补记（含最近记录）
        const all = this.data.results.map((r) => r.params)
        store.pushBatchRecent(all)
        this._hisId = store.pushBatchHistory(all, newOk)
      }
    }
    cache.sweepExports().catch(() => {})
    const still = failIdx.length - newOk
    this.setData({
      running: false,
      progress: '',
      okCount: this.data.results.filter((r) => r.ok).length,
      failCount: still,
    })
    if (still > 0) {
      // RK-14：仍有失败必须显式，不得含糊
      wx.showModal({
        title: '仍有失败',
        content: `${still} 张仍生成失败。可再次重试，或返回逐张生成（单张失败更容易定位原因）。`,
        showCancel: false,
      })
    }
  },

  // ---------- 存相册（单文件 API，循环逐张） ----------

  async saveAll() {
    if (this.data.saving) return
    const todo = this.data.results.filter((r) => r.ok && !r.saved)
    if (!todo.length) {
      wx.showToast({ title: '没有待保存的图片', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '正在逐张保存…', mask: true })
    const failTitles = []
    for (let i = 0; i < this.data.results.length; i++) {
      const r = this.data.results[i]
      if (!r.ok || r.saved) continue
      try {
        await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({ filePath: r.tempPath, success: resolve, fail: reject })
        })
        this.setData({ [`results[${i}].saved`]: true, [`results[${i}].saveFail`]: false })
      } catch (err) {
        this.setData({ [`results[${i}].saveFail`]: true })
        failTitles.push(r.title)
      }
    }
    wx.hideLoading()
    this.setData({ saving: false })
    if (!failTitles.length) {
      wx.showToast({ title: `${todo.length} 张已全部存入相册`, icon: 'success' })
      return
    }
    // RK-14：部分保存失败必须显式列出，**不得显示「完成」**
    wx.showModal({
      title: '部分保存失败',
      content: `${failTitles.length} 张未存入相册：${failTitles.join('、')}。可再次点击「全部存相册」重试（已成功的会自动跳过）。`,
      showCancel: false,
    })
  },

  // 预览（只看生成成功的）
  preview(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.results[idx]
    if (!item || !item.ok) return
    const urls = this.data.results.filter((r) => r.ok).map((r) => r.tempPath)
    wx.previewImage({ urls, current: item.tempPath })
  },

  done() {
    wx.navigateBack()
  },
})
