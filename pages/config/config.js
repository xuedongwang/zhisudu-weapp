// pages/config/config.js
// 配置页：实时预览 + 参数面板 + 导出（PRD FR-02/03/06/09/17/18）
//
// 支持入口：
//   type=纸型key          默认参数
//   type=xx&params=JSON   带参数（最近记录 / 打印历史复用 / 分享落地）
//   type=xx&tpl=模板id    套用模板（底部按钮变「更新模板」）
//
// v1.1 参数结构：页面级（size/orient/margin/color/style/layout）+ 区块级（blocks[]）。
// 旧的扁平参数从任何入口进来都会被 papers.normalizeParams 升级为「单区块整页」。

const papers = require('../../utils/papers')
const draw = require('../../utils/draw')
const exporter = require('../../utils/exporter')
const store = require('../../utils/store')
const track = require('../../utils/track')
const cache = require('../../utils/cache')

Page({
  data: {
    // ---------- 页面级 ----------
    size: 'a4',
    sizeOptions: papers.SIZES,
    layout: '1x1',
    layoutOptions: papers.LAYOUTS,
    orient: 'p',
    margin: 10,
    color: '#333333',
    style: 'solid',
    colors: papers.COLORS,
    styles: papers.STYLES,

    // ---------- 区块 ----------
    blocks: [],        // 展示用：[{type, shortName, cell, ...}]
    active: 0,         // 当前编辑的区块下标
    multi: false,      // layout !== '1x1'
    paperOptions: [],  // 区块纸型选择（全量纸型）
    blockType: '',
    blockName: '',
    cellLabel: '格宽',
    cell: 12,
    cellMin: 8,
    cellMax: 20,
    cellStep: 0.5,
    hasCols: false,
    cols: 2,
    extras: [],        // 当前区块的纸型专属参数控件

    // ---------- 展示文案 ----------
    orientText: '纵向',
    sizeText: 'A4',
    layoutText: '整页',
    exportNote: '',

    // 预览画布 css 尺寸
    pw: 0,
    ph: 0,
    // 导出状态
    exporting: false,
    // 入口标识：true 表示由「我的模板」套用进入（底部按钮为「更新模板」）
    isFromTpl: false,
    // 入口标识：true 表示由好友分享的卡片进入（顶部展示承接提示条，FR-15.6）
    fromShare: false,
    tipClosed: false,
  },

  onLoad(options) {
    // ---------- 取参数：模板 > 显式参数 > 默认 ----------
    let params = null
    if (options.tpl) {
      const tpl = store.findTemplate(options.tpl)
      if (tpl) params = papers.normalizeParams(tpl.params, options.type)
    } else if (options.params) {
      try {
        params = papers.normalizeParams(JSON.parse(decodeURIComponent(options.params)), options.type)
      } catch (e) { /* 参数解析失败则退回默认 */ }
    }
    if (!params) {
      const t = papers.PAPERS[options.type] ? options.type : 'tianzige'
      params = papers.defaultParams(t)
    }

    this._params = params
    this._active = 0
    // 模板入口：记录 id 与参数快照，用于判断是否被改动
    this._tplId = options.tpl || ''
    this._originSig = papers.signature(params)

    this.setData({
      paperOptions: Object.keys(papers.PAPERS).map((k) => ({
        key: k, name: papers.PAPERS[k].name,
      })),
      isFromTpl: !!options.tpl,
      // 分享落地：onShareAppMessage 的 path 带 from=share（好友点开分享卡片直达本页）
      fromShare: options.from === 'share',
    })
    this._syncView()

    // 埋点：进入配置页（生成完成率的分母口径 = 进入配置页用户数）
    track.resetParamDedup()
    track.pageView('config')
    // 分享落地归因（FR-15.9）：复用已有 source 属性、新增取值 'share'，后台无需改配置。
    // 语义 = 经好友分享进入该纸型配置页。之所以报在 paper_select 上：一是配置页本来
    // 就是 paper_select 的落地页，二是这样分享回流用户会一并进「生成完成率」分母。
    if (options.from === 'share') {
      track.report('paper_select', { paper_type: params.blocks[0].type, source: 'share' })
    }
  },

  // 关闭分享落地提示条
  closeShareTip() {
    this.setData({ tipClosed: true })
  },

  onReady() {
    this._initPreview()
  },

  // ---------- 视图同步（参数 → 视图字段） ----------
  _syncView() {
    const p = this._params
    const blocks = p.blocks.map((b, i) => ({
      ...b,
      shortName: `${i + 1} ${papers.PAPERS[b.type].short || papers.PAPERS[b.type].name}`,
    }))
    const cur = p.blocks[this._active] || p.blocks[0]
    const paper = papers.PAPERS[cur.type]
    const size = papers.findSize(p.size)
    const layout = papers.findLayout(p.layout)
    const px = papers.pixelSize(p.size, p.orient, 300)

    this.setData({
      size: p.size,
      layout: p.layout,
      orient: p.orient,
      margin: p.margin,
      color: p.color,
      style: p.style,
      blocks,
      active: this._active,
      multi: p.layout !== '1x1',
      blockType: cur.type,
      blockName: paper.name,
      // v1.1：cell 变为可选（空白纸没有任何可调尺寸）。
      // 早先这里无保护地读 paper.cell.label，遇到无 cell 的纸型会直接抛错 → 配置页白屏。
      // hasCell 为假时，模板里「格宽」整行（含滑杆）不渲染，避免出现拖了没反应的控件。
      hasCell: !!paper.cell,
      cellLabel: paper.cell ? paper.cell.label : '',
      cell: paper.cell ? cur.cell : 0,
      cellMin: paper.cell ? paper.cell.min : 0,
      cellMax: paper.cell ? paper.cell.max : 0,
      cellStep: paper.cell ? paper.cell.step : 0,
      hasCols: !!paper.hasCols,
      cols: cur.cols || 2,
      extras: (paper.extra || []).map((e) => ({
        key: e.key, label: e.label, min: e.min, max: e.max, step: e.step,
        unit: e.unit || '', value: cur[e.key],
      })),
      orientText: p.orient === 'l' ? '横向' : '纵向',
      sizeText: size.name,
      layoutText: layout.name,
      exportNote: `${size.name} · 300DPI（${px.w}×${px.h}px）· 保存相册 / 分享`,
    })

    wx.setNavigationBarTitle({
      title: p.layout === '1x1' ? paper.name : `${layout.name} · ${blocks.length} 区`,
    })
  },

  // ---------- 预览画布 ----------
  _initPreview() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    // 页面左右留白 32rpx×2 + 纸张舞台内边距 20rpx×2 ≈ 104rpx
    const cssW = win.windowWidth - 52
    // 纸张比例跟着规格与方向走（原来写死 A4）
    const mm = papers.pageSizeMm(this._params.size, this._params.orient)
    const cssH = cssW * (mm.h / mm.w)
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
    const p = this._params
    const mm = papers.pageSizeMm(p.size, p.orient)
    // 按「纸张宽度」定比例。原实现横向时误用 cssH 作基准，
    // 导致横向预览画布只有应有分辨率的 70%（均匀缩小后拉伸显示、偏糊），此处一并修正。
    const k = (this._cssW * this._dpr) / mm.w
    const w = Math.round(mm.w * k)
    const h = Math.round(mm.h * k)
    this._canvas.width = w
    this._canvas.height = h
    draw.drawPage(this._ctx, {
      size: p.size,
      orient: p.orient,
      margin: p.margin,
      color: p.color,
      style: p.style,
      layout: p.layout,
      blocks: p.blocks,
      widthPx: w,
      heightPx: h,
      pxPerMm: k,
    })
  },

  // 当前区块纸型（埋点用）
  _curType() {
    const b = this._params.blocks[this._active] || this._params.blocks[0]
    return b.type
  },

  // ---------- 页面级参数事件 ----------
  onSize(e) {
    const v = e.currentTarget.dataset.v
    if (v === this._params.size) return
    track.reportParamChange(this._curType(), 'size')
    this._params.size = v
    this._syncView()
    this._initPreview() // 纸张比例变化，需重算画布尺寸
  },
  onLayout(e) {
    const v = e.currentTarget.dataset.v
    if (v === this._params.layout) return
    track.reportParamChange(this._curType(), 'layout')
    const need = papers.blockCount(v)
    let blocks = this._params.blocks.slice(0, need)
    while (blocks.length < need) {
      // 新增区块沿用首个区块的纸型：先摆好第一格，再逐个改，比随机塞一个纸型更符合直觉
      const src = blocks[0] || papers.defaultBlock('tianzige')
      blocks.push(papers.normalizeBlock({ type: src.type }, src.type))
    }
    this._params.layout = v
    this._params.blocks = blocks
    this._active = 0
    this._syncView()
    this._drawPreview()
  },
  onMarginInput(e) {
    track.reportParamChange(this._curType(), 'margin')
    this._params.margin = parseInt(e.detail.value, 10)
    this._syncView()
    this._drawPreview()
  },
  onOrient(e) {
    const orient = e.currentTarget.dataset.v
    if (orient === this._params.orient) return
    track.reportParamChange(this._curType(), 'orient')
    this._params.orient = orient
    this._syncView()
    this._initPreview() // 方向切换需重算画布尺寸
  },
  onColor(e) {
    track.reportParamChange(this._curType(), 'color')
    this._params.color = e.currentTarget.dataset.v
    this._syncView()
    this._drawPreview()
  },
  onStyle(e) {
    track.reportParamChange(this._curType(), 'style')
    this._params.style = e.currentTarget.dataset.v
    this._syncView()
    this._drawPreview()
  },

  // ---------- 区块级事件 ----------
  onPickBlock(e) {
    const i = parseInt(e.currentTarget.dataset.i, 10)
    if (i === this._active) return
    this._active = i
    this._syncView()
  },
  // 切换当前区块的纸型：重置为该纸型的默认参数（不沿用上一个纸型的格宽，避免量纲错配）
  onBlockType(e) {
    const v = e.currentTarget.dataset.v
    if (v === this._curType()) return
    // source=block：区块内换纸型。新增取值，后台属性范围留空故无需改配置
    track.report('paper_select', { paper_type: v, source: 'block' })
    this._params.blocks[this._active] = papers.normalizeBlock({ type: v }, v)
    this._syncView()
    this._drawPreview()
  },
  onCellInput(e) {
    track.reportParamChange(this._curType(), 'cell', this._active)
    this._params.blocks[this._active].cell = parseFloat(e.detail.value)
    this._syncView()
    this._drawPreview()
  },
  onCols(e) {
    track.reportParamChange(this._curType(), 'cols', this._active)
    this._params.blocks[this._active].cols = parseInt(e.currentTarget.dataset.v, 10)
    this._syncView()
    this._drawPreview()
  },
  // 纸型专属参数（康奈尔线索栏宽、周计划行数等）
  onExtraInput(e) {
    const key = e.currentTarget.dataset.k
    track.reportParamChange(this._curType(), key, this._active)
    this._params.blocks[this._active][key] = parseFloat(e.detail.value)
    this._syncView()
    this._drawPreview()
  },

  // ---------- 存为模板 / 更新模板（FR-09） ----------
  // 入口区分：从「我的模板」套用进入 → 就地覆盖原模板；从纸型卡片进入 → 新增一条
  onSaveTemplate() {
    const params = this._params
    const t0 = params.blocks[0].type

    if (this._tplId) {
      if (papers.signature(params) === this._originSig) {
        wx.showToast({ title: '参数未修改，无需更新', icon: 'none' })
        return
      }
      const res = store.updateTemplate(this._tplId, params)
      if (res.ok) {
        // source='template' 标记这是覆盖更新（非新增），避免污染「模板复用率」的分母
        track.report('template_save', { paper_type: t0, source: 'template' })
        this._originSig = papers.signature(params)
      }
      wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
      return
    }

    const res = store.saveTemplate(params)
    if (res.ok) track.report('template_save', { paper_type: t0 })
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
  },

  // ---------- 导出（FR-06） ----------
  async onExport() {
    if (this.data.exporting) return
    this.setData({ exporting: true })
    wx.showLoading({ title: '正在渲染…', mask: true })
    const params = this._params
    const t0 = params.blocks[0].type
    try {
      const result = await exporter.generateImage(params)
      store.pushRecent(params) // FR-10 记录最近生成（参数复用，同配置去重）
      store.pushHistory(params, { dpi: result.dpi }) // FR-16 打印历史流水（按次）
      // 导出图清理：本次文件是最新的必然保留，旧图按保留数回收。
      // 仅靠启动时清扫不够——单次会话内连续导出数十次也不会重启。
      cache.sweepExports().catch(() => {})
      // 埋点：导出成功（记录实际 DPI 与耗时，降级情况可从 dpi 值识别）
      track.report('export_success', {
        paper_type: t0,
        dpi: result.dpi,
        duration_ms: result.durationMs,
      })
      const app = getApp()
      app.globalData.exportResult = { ...result, params }
      wx.hideLoading()
      this.setData({ exporting: false })
      wx.navigateTo({ url: '/pages/success/success' })
    } catch (err) {
      track.exportFail(t0, err)
      wx.hideLoading()
      this.setData({ exporting: false })
      wx.showModal({
        title: '导出失败',
        content: (err && err.message) || '渲染异常，请重试',
        showCancel: false,
      })
    }
  },

  // 转发卡片（FR-15）：把「整页参数」带出去，好友点开直达同款配置页。
  // 参数经 encodeURIComponent 编码；多区块时路径会变长，实测见 PRD 第十章附注。
  onShareAppMessage() {
    const params = this._params
    const p = papers.PAPERS[params.blocks[0].type]
    const layout = papers.findLayout(params.layout)
    track.report('share_click', { page_name: 'config', paper_type: params.blocks[0].type })

    // v1.1：无 cell 的纸型（空白纸）不拼「（8mm）」这样的参数——会拼出「（undefinedmm）」
    const cellOf = params.blocks[0].cell
    const title = params.layout === '1x1'
      ? (p ? `已配好一张${p.name}${cellOf !== undefined ? `（${cellOf}mm）` : ''}，点开就能打印` : '纸速打 · 免费打印练习纸')
      : `已配好一张${layout.name}（${params.blocks.length} 区），点开就能打印`

    const encoded = encodeURIComponent(JSON.stringify(params))
    return {
      title,
      // from=share 是分享落地承接与归因的唯一凭据：
      // 只有分享路径会带它，好友点开后配置页据此展示承接提示条并上报 source=share。
      path: `/pages/config/config?type=${params.blocks[0].type}&params=${encoded}&from=share`,
    }
  },
})
