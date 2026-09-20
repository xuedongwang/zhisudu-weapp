// pages/config/config.js
// 配置页：实时预览 + 参数面板 + 导出（PRD FR-02/03/06/09）
// 支持入口：type=纸型key（默认参数）/ params=JSON（最近记录复用）/ tpl=模板id（套用模板）

const papers = require('../../utils/papers')
const draw = require('../../utils/draw')
const exporter = require('../../utils/exporter')
const store = require('../../utils/store')

Page({
  data: {
    type: '',
    paperName: '',
    cellLabel: '格宽',
    // 参数（与 papers.defaultParams 同构）
    cell: 12,
    margin: 10,
    color: '#333333',
    style: 'solid',
    cols: 2,
    orient: 'p',
    // 控件元数据
    cellMin: 8,
    cellMax: 20,
    cellStep: 0.5,
    colors: papers.COLORS,
    styles: papers.STYLES,
    hasCols: false,
    // 预览画布 css 尺寸
    pw: 0,
    ph: 0,
    // 导出状态
    exporting: false,
  },

  onLoad(options) {
    const type = options.type || 'tianzige'
    const paper = papers.PAPERS[type]
    if (!paper) {
      wx.showToast({ title: '纸型不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    let params = papers.defaultParams(type)
    // 优先级：模板 > 显式参数 > 默认
    if (options.tpl) {
      const tpl = store.findTemplate(options.tpl)
      if (tpl && tpl.type === type) params = { ...params, ...tpl.params }
    } else if (options.params) {
      try {
        const p = JSON.parse(decodeURIComponent(options.params))
        if (p && p.type === type) params = { ...params, ...p }
      } catch (e) { /* 参数解析失败则用默认 */ }
    }
    this.setData({
      type,
      paperName: paper.name,
      cellLabel: paper.cell.label,
      cellMin: paper.cell.min,
      cellMax: paper.cell.max,
      cellStep: paper.cell.step,
      hasCols: !!paper.hasCols,
      cell: params.cell,
      margin: params.margin,
      color: params.color,
      style: params.style,
      cols: params.cols,
      orient: params.orient,
    })
    wx.setNavigationBarTitle({ title: paper.name })
  },

  onReady() {
    this._initPreview()
  },

  // ---------- 预览画布 ----------
  _initPreview() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    // 页面左右留白 32rpx×2 + 纸张舞台内边距 20rpx×2 ≈ 104rpx
    const cssW = win.windowWidth - 52
    const landscape = this.data.orient === 'l'
    const cssH = landscape ? cssW * (210 / 297) : cssW * (297 / 210)
    const dpr = Math.min(win.pixelRatio || 2, 3)
    this.setData({ pw: cssW, ph: cssH }, () => {
      wx.createSelectorQuery()
        .in(this)
        .select('#preview')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return
          const canvas = res[0].node
          canvas.width = Math.round(cssW * dpr)
          canvas.height = Math.round(cssH * dpr)
          this._canvas = canvas
          this._ctx = canvas.getContext('2d')
          this._dpr = dpr
          this._cssW = cssW
          this._cssH = cssH
          this._drawPreview()
        })
    })
  },

  // 实时预览：参数变更后重绘（PRD FR-03.1）
  _drawPreview() {
    if (!this._ctx) return
    const d = this.data
    const landscape = d.orient === 'l'
    // 画布代表一张 A4：pxPerMm 按 css 尺寸换算并乘 dpr 保证清晰
    const wMm = landscape ? 297 : 210
    const k = ((landscape ? this._cssH : this._cssW) * this._dpr) / wMm
    const w = Math.round((landscape ? 297 : 210) * k)
    const h = Math.round((landscape ? 210 : 297) * k)
    this._canvas.width = w
    this._canvas.height = h
    draw.drawPaper(this._ctx, {
      type: d.type, cell: d.cell, margin: d.margin, color: d.color,
      style: d.style, cols: d.cols,
      widthPx: w, heightPx: h, pxPerMm: k,
    })
  },

  // ---------- 参数事件 ----------
  onCellInput(e) {
    this.setData({ cell: parseFloat(e.detail.value) }, () => this._drawPreview())
  },
  onMarginInput(e) {
    this.setData({ margin: parseInt(e.detail.value, 10) }, () => this._drawPreview())
  },
  onOrient(e) {
    const orient = e.currentTarget.dataset.v
    if (orient === this.data.orient) return
    this.setData({ orient }, () => {
      this._initPreview() // 方向切换需重算画布尺寸
    })
  },
  onColor(e) {
    this.setData({ color: e.currentTarget.dataset.v }, () => this._drawPreview())
  },
  onStyle(e) {
    this.setData({ style: e.currentTarget.dataset.v }, () => this._drawPreview())
  },
  onCols(e) {
    this.setData({ cols: parseInt(e.currentTarget.dataset.v, 10) }, () => this._drawPreview())
  },

  // ---------- 存为模板（FR-09） ----------
  onSaveTemplate() {
    const d = this.data
    const res = store.saveTemplate(d.type, {
      type: d.type, cell: d.cell, margin: d.margin, color: d.color,
      style: d.style, cols: d.cols, orient: d.orient,
    })
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
  },

  // ---------- 导出（FR-06） ----------
  async onExport() {
    if (this.data.exporting) return
    this.setData({ exporting: true })
    wx.showLoading({ title: '正在渲染…', mask: true })
    const d = this.data
    const params = {
      type: d.type, cell: d.cell, margin: d.margin, color: d.color,
      style: d.style, cols: d.cols, orient: d.orient,
    }
    try {
      const result = await exporter.generateImage(params)
      store.pushRecent(d.type, params) // FR-10 记录最近生成
      const app = getApp()
      app.globalData.exportResult = { ...result, params }
      wx.hideLoading()
      this.setData({ exporting: false })
      wx.navigateTo({ url: '/pages/success/success' })
    } catch (err) {
      wx.hideLoading()
      this.setData({ exporting: false })
      wx.showModal({
        title: '导出失败',
        content: (err && err.message) || '渲染异常，请重试',
        showCancel: false,
      })
    }
  },
})
