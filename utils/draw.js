// utils/draw.js
// 纸张绘制引擎（canvas 2d）。参数口径：格宽、边距、线宽均以 mm 定义，绘制时乘 pxPerMm。
//
// v1.1 结构调整（FR-18 单页多区块）：
//   旧：drawPaper(ctx, {type, cell, margin, ...}) —— 全文以整页 W/H 为绝对参照，
//       内容区恒为 (margin, margin, W-2margin, H-2margin)，无法分区块。
//   新：drawBlock(ctx, {box, type, cell, ...}) —— 只认「盒子」box{x,y,w,h}（已是内容区，
//       页面边距由 drawPage 扣除），所有边界与居中计算都基于盒子。
//   drawPage() 负责铺白底 + 按 papers.layoutBoxes 逐区块 clip 绘制。
//
// ⚠️ 重构的硬约束：**1×1 时必须与重构前逐像素一致**。box.x = margin*k、box.w = W-2*margin*k 时，
//    居中公式 (W - n*cs)/2 恒等于 box.x + (box.w - n*cs)/2，故所有分支可直接机械替换。
//    这是可以放心重构的前提，也是自测里要做对照验证的原因。

const papers = require('./papers')

// 线型 → canvas dash 数组（间距单位 mm，需乘 pxPerMm）
function dashPattern(style, k) {
  if (style === 'dash') return [2.2 * k, 1.6 * k]
  if (style === 'dot') return [0.1 * k, 1.4 * k]
  return null
}

// 统一设置描边状态
function applyStroke(ctx, color, widthPx, style, k) {
  ctx.strokeStyle = color
  ctx.lineWidth = widthPx
  const d = dashPattern(style, k)
  ctx.setLineDash(d || [])
  ctx.lineCap = style === 'solid' ? 'butt' : 'round'
}

// 该盒子放得下就画，放不下（格宽大于区块）就留白——避免画出跨界的内容
function gridCount(span, unit) {
  return Math.floor(span / unit)
}

/**
 * 在一个「盒子」内绘制一种纸型
 * o: {
 *   box: {x, y, w, h},   // 像素，已是内容区
 *   type, cell(mm), color, style, cols,    // 区块参数
 *   cue, rows,                             // 纸型专属参数（康奈尔 / 周计划）
 *   pxPerMm,                               // dpi / 25.4
 *   thumb                                  // 缩略图模式：加粗线宽便于小尺寸辨识
 * }
 */
function drawBlock(ctx, o) {
  const box = o.box
  const k = o.pxPerMm
  const color = o.color
  const style = o.style
  const cols = o.cols || 1
  const cell = o.cell
  const thumb = !!o.thumb

  const L = box.x
  const T = box.y
  const R = box.x + box.w
  const B = box.y + box.h
  const bw = box.w
  const bh = box.h

  // 线宽：外框 0.3mm、内虚线 0.28mm；缩略图模式加粗；低于 0.5px 兜底
  const frameW = Math.max((thumb ? 0.8 : 0.3) * k, 0.5)
  const dashW = Math.max((thumb ? 0.6 : 0.28) * k, 0.5)
  const mainW = Math.max((thumb ? 0.9 : 0.35) * k, 0.5)

  // ---------- 田字格 / 米字格 ----------
  if (o.type === 'tianzige' || o.type === 'mizige') {
    const cs = cell * k
    const nCols = gridCount(bw, cs)
    const nRows = gridCount(bh, cs)
    if (nCols < 1 || nRows < 1) return
    const sx = L + (bw - nCols * cs) / 2 // 盒内居中：余量均分两侧
    const sy = T + (bh - nRows * cs) / 2

    applyStroke(ctx, color, dashW, style, k)
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        const x = sx + c * cs
        const y = sy + r * cs
        // 对角线：仅米字格
        if (o.type === 'mizige') {
          ctx.beginPath()
          ctx.moveTo(x, y); ctx.lineTo(x + cs, y + cs)
          ctx.moveTo(x + cs, y); ctx.lineTo(x, y + cs)
          ctx.stroke()
        }
        // 十字
        ctx.beginPath()
        ctx.moveTo(x + cs / 2, y); ctx.lineTo(x + cs / 2, y + cs)
        ctx.moveTo(x, y + cs / 2); ctx.lineTo(x + cs, y + cs / 2)
        ctx.stroke()
      }
    }
    // 逐格外框（实线，不受线型影响）
    applyStroke(ctx, color, frameW, 'solid', k)
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        ctx.strokeRect(sx + c * cs, sy + r * cs, cs, cs)
      }
    }
  }

  // ---------- 拼音 / 英语四线三格 ----------
  else if (o.type === 'pinyin' || o.type === 'english') {
    const rowH = cell * k
    const gap = 5 * k
    let y = T
    while (y + rowH <= B) {
      for (let i = 0; i < 4; i++) {
        const ly = y + (rowH / 3) * i
        const solid = i === 0 || i === 3 // 上下主线恒为实线
        applyStroke(ctx, color, solid ? mainW : dashW, solid ? 'solid' : style, k)
        ctx.beginPath()
        ctx.moveTo(L, ly)
        ctx.lineTo(R, ly)
        ctx.stroke()
      }
      y += rowH + gap
    }
  }

  // ---------- 拼音田字格（四线条 + 田字行交替） ----------
  else if (o.type === 'pinyintian') {
    const stripH = 12 * k
    const gap = 3 * k
    const cs = cell * k
    let y = T
    while (true) {
      // 四线三格条
      if (y + stripH > B) break
      for (let i = 0; i < 4; i++) {
        const ly = y + (stripH / 3) * i
        const solid = i === 0 || i === 3
        applyStroke(ctx, color, solid ? mainW : dashW, 'solid', k)
        ctx.beginPath()
        ctx.moveTo(L, ly)
        ctx.lineTo(R, ly)
        ctx.stroke()
      }
      y += stripH + gap
      // 田字格行
      if (y + cs > B) break
      const nCols = gridCount(bw, cs)
      if (nCols < 1) break
      const sx = L + (bw - nCols * cs) / 2
      applyStroke(ctx, color, dashW, style, k)
      for (let c = 0; c < nCols; c++) {
        const x = sx + c * cs
        ctx.beginPath()
        ctx.moveTo(x + cs / 2, y); ctx.lineTo(x + cs / 2, y + cs)
        ctx.moveTo(x, y + cs / 2); ctx.lineTo(x + cs, y + cs / 2)
        ctx.stroke()
      }
      applyStroke(ctx, color, frameW, 'solid', k)
      for (let c = 0; c < nCols; c++) {
        ctx.strokeRect(sx + c * cs, y, cs, cs)
      }
      y += cs + gap
    }
  }

  // ---------- 口算纸（空白算式格，支持分栏） ----------
  else if (o.type === 'kousuan') {
    const gapC = 8 * k  // 栏间距
    const ch = 14 * k   // 行高
    const colW = (bw - (cols - 1) * gapC) / cols
    const nRows = gridCount(bh, ch)
    if (colW <= 0 || nRows < 1) return
    applyStroke(ctx, color, frameW, 'solid', k)
    for (let c = 0; c < cols; c++) {
      const x0 = L + c * (colW + gapC)
      for (let r = 0; r < nRows; r++) {
        ctx.strokeRect(x0, T + r * ch, colW, ch)
      }
    }
  }

  // ---------- 作文方格纸 ----------
  else if (o.type === 'zuowen') {
    const cs = cell * k
    const nCols = gridCount(bw, cs)
    const nRows = gridCount(bh, cs)
    if (nCols < 1 || nRows < 1) return
    const sx = L + (bw - nCols * cs) / 2
    const sy = T + (bh - nRows * cs) / 2
    applyStroke(ctx, color, Math.max(0.2 * k, 0.5), 'solid', k)
    ctx.beginPath()
    for (let i = 0; i <= nCols; i++) {
      ctx.moveTo(sx + i * cs, sy)
      ctx.lineTo(sx + i * cs, sy + nRows * cs)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let r = 0; r <= nRows; r++) {
      ctx.moveTo(sx, sy + r * cs)
      ctx.lineTo(sx + nCols * cs, sy + r * cs)
    }
    ctx.stroke()
    applyStroke(ctx, color, frameW, 'solid', k)
    ctx.strokeRect(sx, sy, nCols * cs, nRows * cs)
  }

  // ---------- 控笔纸（虚线曲线描红） ----------
  else if (o.type === 'kongbi') {
    const gap = cell * k + 6 * k
    let y = T + 10 * k
    let i = 0
    while (y < B - 10 * k) {
      const amp = 8 * k
      const wl = bw / 3
      const up = i % 2 === 0 ? -amp : amp
      applyStroke(ctx, color, Math.max(0.45 * k, 1), 'dash', k)
      ctx.setLineDash([2.6 * k, 2 * k])
      ctx.beginPath()
      ctx.moveTo(L, y)
      ctx.quadraticCurveTo(L + wl * 0.5, y + up * 1.8, L + wl, y)
      ctx.quadraticCurveTo(L + wl * 1.5, y - up * 1.8, L + wl * 2, y)
      ctx.quadraticCurveTo(L + wl * 2.5, y + up * 1.8, R, y)
      ctx.stroke()
      // 起笔点
      ctx.setLineDash([])
      ctx.globalAlpha = 0.5
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(L, y, 1.4 * k, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      y += gap
      i++
    }
  }

  // ---------- 坐标纸（方格，每 5 格加重） ----------
  else if (o.type === 'zuobiao') {
    const cs = cell * k
    const nCols = gridCount(bw, cs)
    const nRows = gridCount(bh, cs)
    if (nCols < 1 || nRows < 1) return
    const sx = L + (bw - nCols * cs) / 2
    const sy = T + (bh - nRows * cs) / 2
    const minorW = Math.max((thumb ? 0.5 : 0.15) * k, 0.5)
    const majorW = Math.max((thumb ? 0.9 : 0.35) * k, 0.5)
    const MAJOR = 5 // 每 5 格一条重线

    // 细线（整体降低透明度，避免密格印出来发灰）
    ctx.save()
    ctx.globalAlpha = 0.45
    applyStroke(ctx, color, minorW, 'solid', k)
    ctx.beginPath()
    for (let i = 1; i < nCols; i++) {
      if (i % MAJOR === 0) continue
      ctx.moveTo(sx + i * cs, sy)
      ctx.lineTo(sx + i * cs, sy + nRows * cs)
    }
    for (let j = 1; j < nRows; j++) {
      if (j % MAJOR === 0) continue
      ctx.moveTo(sx, sy + j * cs)
      ctx.lineTo(sx + nCols * cs, sy + j * cs)
    }
    ctx.stroke()
    ctx.restore()

    // 重线 + 外框
    applyStroke(ctx, color, majorW, 'solid', k)
    ctx.beginPath()
    for (let i = MAJOR; i < nCols; i += MAJOR) {
      ctx.moveTo(sx + i * cs, sy)
      ctx.lineTo(sx + i * cs, sy + nRows * cs)
    }
    for (let j = MAJOR; j < nRows; j += MAJOR) {
      ctx.moveTo(sx, sy + j * cs)
      ctx.lineTo(sx + nCols * cs, sy + j * cs)
    }
    ctx.stroke()
    ctx.strokeRect(sx, sy, nCols * cs, nRows * cs)
  }

  // ---------- 五线谱纸（五行谱表，谱表间留空） ----------
  else if (o.type === 'wuxianpu') {
    const sp = cell * k       // 谱线间距
    const staffH = sp * 4     // 一个谱表 5 条线 = 4 个间距
    const groupGap = Math.max(sp * 3, 7 * k) // 谱表之间留空，便于书写
    if (staffH <= 0) return
    const w = Math.max((thumb ? 0.7 : 0.25) * k, 0.5)
    applyStroke(ctx, color, w, 'solid', k)
    let y = T
    while (y + staffH <= B) {
      ctx.beginPath()
      for (let i = 0; i < 5; i++) {
        const ly = y + sp * i
        ctx.moveTo(L, ly)
        ctx.lineTo(R, ly)
      }
      ctx.stroke()
      y += staffH + groupGap
    }
  }

  // ---------- 康奈尔笔记纸（线索栏 + 笔记区 + 总结栏） ----------
  else if (o.type === 'kangnaier') {
    const rowH = cell * k
    const topH = 22 * k   // 顶部标题区
    const botH = 32 * k   // 底部总结区
    const ratio = Math.min(Math.max((o.cue || 30) / 100, 0.1), 0.6)
    if (bh < topH + botH + rowH) {
      // 区块太矮，退化为只画外框，不硬塞分区线
      applyStroke(ctx, color, frameW, 'solid', k)
      ctx.strokeRect(L, T, bw, bh)
      return
    }
    const bodyT = T + topH
    const bodyB = B - botH
    const cueX = L + bw * ratio

    // 外框
    applyStroke(ctx, color, frameW, 'solid', k)
    ctx.strokeRect(L, T, bw, bh)
    // 标题区底线、总结区顶线、线索栏竖线（均实线）
    applyStroke(ctx, color, mainW, 'solid', k)
    ctx.beginPath()
    ctx.moveTo(L, bodyT); ctx.lineTo(R, bodyT)
    ctx.moveTo(L, bodyB); ctx.lineTo(R, bodyB)
    ctx.moveTo(cueX, bodyT); ctx.lineTo(cueX, bodyB)
    ctx.stroke()
    // 笔记区横线（跟随线型；横线通栏，含线索栏）
    const nRows = gridCount(bodyB - bodyT, rowH)
    if (nRows > 0) {
      applyStroke(ctx, color, dashW, style, k)
      ctx.beginPath()
      for (let i = 1; i <= nRows; i++) {
        const ly = bodyT + i * rowH
        if (ly > bodyB - 0.5) break
        ctx.moveTo(L, ly)
        ctx.lineTo(R, ly)
      }
      ctx.stroke()
    }
  }

  // ---------- 周计划表（7 列 × N 行，含星期表头） ----------
  else if (o.type === 'zhoujihua') {
    const rowH = cell * k
    const rows = Math.round(o.rows || 8)
    const nCols = 7
    const headH = Math.max(rowH * 0.9, 10 * k)
    const colW = bw / nCols
    if (colW <= 0 || rowH <= 0) return
    const headBottom = T + headH
    const dataBottom = Math.min(headBottom + rows * rowH, B)

    // 外框
    applyStroke(ctx, color, frameW, 'solid', k)
    ctx.strokeRect(L, T, bw, bh)
    // 列分隔线（含表头）
    applyStroke(ctx, color, dashW, style, k)
    ctx.beginPath()
    for (let c = 1; c < nCols; c++) {
      const x = L + c * colW
      ctx.moveTo(x, T)
      ctx.lineTo(x, dataBottom)
    }
    ctx.stroke()
    // 行分隔线
    ctx.beginPath()
    for (let r = 1; r <= rows; r++) {
      const ly = headBottom + r * rowH
      if (ly > B + 0.01) break
      ctx.moveTo(L, ly)
      ctx.lineTo(R, ly)
    }
    ctx.stroke()
    // 表头底线（实线，与内容区分隔更清楚）
    applyStroke(ctx, color, mainW, 'solid', k)
    ctx.beginPath()
    ctx.moveTo(L, headBottom)
    ctx.lineTo(R, headBottom)
    ctx.stroke()

    // 星期文字：逐格 clip，防止窄列时溢出到相邻列
    ctx.save()
    ctx.fillStyle = color
    ctx.font = `${Math.max(4.2 * k, 9)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const names = ['一', '二', '三', '四', '五', '六', '日']
    for (let c = 0; c < nCols; c++) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(L + c * colW, T, colW, headH)
      ctx.clip()
      ctx.fillText(`周${names[c]}`, L + c * colW + colW / 2, headBottom - headH / 2)
      ctx.restore()
    }
    ctx.restore()
  }
}

/**
 * 绘制整页：铺白底 + 按版式逐区块 clip 绘制
 * o: {
 *   size, orient, margin, color, style, layout, blocks,
 *   widthPx, heightPx, pxPerMm, thumb
 * }
 */
function drawPage(ctx, o) {
  const k = o.pxPerMm
  const W = o.widthPx
  const H = o.heightPx

  ctx.save()
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  // 盒子直接在**像素**上算：1x1 时恒等于 (margin*k, margin*k, W-2*margin*k, H-2*margin*k)，
  // 与重构前的 m / uw / uh 完全一致，不引入 mm→px 的取整误差
  const boxes = papers.layoutBoxes(o.layout, W, H, o.margin * k, papers.BLOCK_GAP_MM * k)
  const blocks = o.blocks || []

  boxes.forEach((box, i) => {
    const block = blocks[i]
    if (!block) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    ctx.clip()
    drawBlock(ctx, {
      box,
      type: block.type,
      cell: block.cell,
      cols: block.cols,
      cue: block.cue,
      rows: block.rows,
      color: o.color,
      style: o.style,
      pxPerMm: k,
      thumb: o.thumb,
    })
    ctx.restore()
  })
}

/**
 * 兼容包装：单区块整页（旧接口形态）
 * 旧调用方传扁平参数与 widthPx/heightPx/pxPerMm，此处转成 drawPage 的入参。
 */
function drawPaper(ctx, o) {
  drawPage(ctx, {
    size: o.size || papers.DEFAULT_SIZE,
    orient: o.orient === 'l' ? 'l' : 'p',
    margin: o.margin,
    color: o.color,
    style: o.style,
    layout: papers.DEFAULT_LAYOUT,
    blocks: [{ type: o.type, cell: o.cell, cols: o.cols, cue: o.cue, rows: o.rows }],
    widthPx: o.widthPx,
    heightPx: o.heightPx,
    pxPerMm: o.pxPerMm,
    thumb: o.thumb,
  })
}

module.exports = { drawPage, drawBlock, drawPaper, dashPattern, applyStroke }
