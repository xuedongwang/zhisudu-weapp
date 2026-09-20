// utils/draw.js
// 纸张绘制引擎（canvas 2d）——参数口径与原型/PRD 一致：格宽、边距、线宽均以 mm 定义。
// 阶段 0 真机验证结论：300DPI 离屏 canvas 导出可行；网格绘制起点居中（余量均分两侧）。

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

/**
 * 绘制一张练习纸
 * o: {
 *   type, cell(mm), margin(mm), color, style, cols,
 *   widthPx, heightPx,   // 画布像素尺寸（横向时宽>高）
 *   pxPerMm,             // dpi / 25.4
 *   thumb                // 缩略图模式：加粗线宽便于小尺寸辨识
 * }
 */
function drawPaper(ctx, o) {
  const { type, cell, margin, color, style, cols } = o
  const { widthPx: W, heightPx: H } = o
  const k = o.pxPerMm
  const thumb = !!o.thumb

  ctx.save()
  // 白色背景
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  const m = margin * k
  const uw = W - m * 2
  const uh = H - m * 2
  // 线宽：外框 0.3mm、内虚线 0.28mm；缩略图模式加粗；低于 0.5px 兜底
  const frameW = Math.max((thumb ? 0.8 : 0.3) * k, 0.5)
  const dashW = Math.max((thumb ? 0.6 : 0.28) * k, 0.5)
  const mainW = Math.max((thumb ? 0.9 : 0.35) * k, 0.5)

  // ---------- 田字格 / 米字格 ----------
  if (type === 'tianzige' || type === 'mizige') {
    const cs = cell * k
    const nCols = Math.floor(uw / cs)
    const nRows = Math.floor(uh / cs)
    const sx = (W - nCols * cs) / 2 // 居中：余量均分左右
    const sy = (H - nRows * cs) / 2

    applyStroke(ctx, color, dashW, style, k)
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        const x = sx + c * cs
        const y = sy + r * cs
        // 对角线：仅米字格
        if (type === 'mizige') {
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
  else if (type === 'pinyin' || type === 'english') {
    const rowH = cell * k
    const gap = 5 * k
    let y = m
    while (y + rowH <= H - m) {
      for (let i = 0; i < 4; i++) {
        const ly = y + (rowH / 3) * i
        const solid = i === 0 || i === 3 // 上下主线恒为实线
        applyStroke(ctx, color, solid ? mainW : dashW, solid ? 'solid' : style, k)
        ctx.beginPath()
        ctx.moveTo(m, ly)
        ctx.lineTo(m + uw, ly)
        ctx.stroke()
      }
      y += rowH + gap
    }
  }

  // ---------- 拼音田字格（四线条 + 田字行交替） ----------
  else if (type === 'pinyintian') {
    const stripH = 12 * k
    const gap = 3 * k
    const cs = cell * k
    let y = m
    while (true) {
      // 四线三格条
      if (y + stripH > H - m) break
      for (let i = 0; i < 4; i++) {
        const ly = y + (stripH / 3) * i
        const solid = i === 0 || i === 3
        applyStroke(ctx, color, solid ? mainW : dashW, 'solid', k)
        ctx.beginPath()
        ctx.moveTo(m, ly)
        ctx.lineTo(m + uw, ly)
        ctx.stroke()
      }
      y += stripH + gap
      // 田字格行
      if (y + cs > H - m) break
      const nCols = Math.floor(uw / cs)
      const sx = (W - nCols * cs) / 2
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
  else if (type === 'kousuan') {
    const gapC = 8 * k   // 栏间距
    const ch = 14 * k    // 行高
    const colW = (uw - (cols - 1) * gapC) / cols
    const nRows = Math.floor((H - m * 2) / ch)
    applyStroke(ctx, color, frameW, 'solid', k)
    for (let c = 0; c < cols; c++) {
      const x0 = m + c * (colW + gapC)
      for (let r = 0; r < nRows; r++) {
        ctx.strokeRect(x0, m + r * ch, colW, ch)
      }
    }
  }

  // ---------- 作文方格纸 ----------
  else if (type === 'zuowen') {
    const cs = cell * k
    const nCols = Math.floor(uw / cs)
    const nRows = Math.floor(uh / cs)
    const sx = (W - nCols * cs) / 2
    const sy = (H - nRows * cs) / 2
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
  else if (type === 'kongbi') {
    const gap = cell * k + 6 * k
    let y = m + 10 * k
    let i = 0
    while (y < H - m - 10 * k) {
      const amp = 8 * k
      const wl = uw / 3
      const up = i % 2 === 0 ? -amp : amp
      applyStroke(ctx, color, Math.max(0.45 * k, 1), 'dash', k)
      ctx.setLineDash([2.6 * k, 2 * k])
      ctx.beginPath()
      ctx.moveTo(m, y)
      ctx.quadraticCurveTo(m + wl * 0.5, y + up * 1.8, m + wl, y)
      ctx.quadraticCurveTo(m + wl * 1.5, y - up * 1.8, m + wl * 2, y)
      ctx.quadraticCurveTo(m + wl * 2.5, y + up * 1.8, m + uw, y)
      ctx.stroke()
      // 起笔点
      ctx.setLineDash([])
      ctx.globalAlpha = 0.5
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(m, y, 1.4 * k, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      y += gap
      i++
    }
  }

  ctx.restore()
}

module.exports = { drawPaper, dashPattern, applyStroke }
