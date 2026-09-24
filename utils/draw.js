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
// v1.2 形式层（与纸型正交的叠加层，drawPage 内按固定次序绘制）：
//   ① 背景色（默认纯白）→ ② 背景纹理（默认无）→ ③ 区块内容 → ④ 页面边框（默认无）→ ⑤ 文字水印（默认无）
//   另有线条粗细倍率 weight 作用于 drawBlock 的所有线宽（1.0 = 不变）。
//   ⚠️ 全部取默认值时输出必须与 v1.1 逐像素一致——这是等价性自测守住的红线。
//
// v1.3 注册表化：drawBlock 由 16 分支 if 链改为「纸型 → 绘制函数」注册表（TYPE_DRAWERS）。
//   每个分支机械搬进独立函数，公共环境抽成 env 对象（盒坐标 / 线宽 / 粗细倍率），
//   分支体内引用的局部变量一一对应为 env 字段，绘制调用序列完全不变。
//   本步是纯搬家：未改任何坐标、线宽、调用次序，等价性自测（与 77ff3ed 全组合比对）证明。
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

// ========== 纸型绘制函数（注册表成员）==========
// 统一签名：fn(ctx, o, e)
//   o: 区块参数 { box, type, cell, cols, cue, rows, ...extra }（纸型专属参数原样携带）
//   e: 公共环境 {
//        L,T,R,B,bw,bh,   // 盒坐标与宽高（像素）
//        k,               // pxPerMm
//        color, style, cols, cell, thumb,
//        wt,              // v1.2 线条粗细倍率（1 = 不变）
//        frameW, dashW, mainW,   // 三档线宽（已含 thumb 加粗与 wt 倍率）
//      }
// 各纸型的共同约定，保证同一张纸上风格统一：
//   · 主内容线用 dashW（二级线宽），跟随用户的线型（实线/虚线/点线）；
//   · 网格类全部先算「放得下几格」再盒内居中（sx = L + (bw - n*cs)/2），不贴边；
//   · 多条线累积到一条 path 后**只 stroke 一次**，减少 canvas 调用次数。

// ---------- 横线纸（每行底边一条线，最上方留出完整一行书写空间）----------
// 行线位置取 T + i*rowH（i 从 1 起），与「康奈尔笔记纸」笔记区完全同构：
// 第一行写在上边距与第一条线之间，因此顶部不会出现"线贴着上边"的逼仄感。
function drawHengxian(ctx, o, e) {
  const rowH = e.cell * e.k
  if (rowH <= 0) return
  const nRows = gridCount(e.bh, rowH)
  if (nRows < 1) return
  applyStroke(ctx, e.color, e.dashW, e.style, e.k)
  ctx.beginPath()
  for (let i = 1; i <= nRows; i++) {
    const ly = e.T + i * rowH
    ctx.moveTo(e.L, ly)
    ctx.lineTo(e.R, ly)
  }
  ctx.stroke()
}

// ---------- 竖线纸（每列右边一条线，最左侧留出完整一列书写空间）----------
function drawShuxian(ctx, o, e) {
  const colW = e.cell * e.k
  if (colW <= 0) return
  const nCols = gridCount(e.bw, colW)
  if (nCols < 1) return
  applyStroke(ctx, e.color, e.dashW, e.style, e.k)
  ctx.beginPath()
  for (let i = 1; i <= nCols; i++) {
    const lx = e.L + i * colW
    ctx.moveTo(lx, e.T)
    ctx.lineTo(lx, e.B)
  }
  ctx.stroke()
}

// ---------- 方格纸（等权方格，无加重线）----------
// 与坐标纸的区别：坐标纸每 5 格加重（用于读数/作图定位），方格纸等权（用于书写/计算）。
// 竖线含 i=0 与 i=nCols、横线含 j=0 与 j=nRows，边界即网格边缘，因此**不再单独描外框**，
// 避免外框与首末格线在像素上叠画出更重的一条（同作文方格纸的外部处理）。
function drawFangge(ctx, o, e) {
  const cs = e.cell * e.k
  if (cs <= 0) return
  const nCols = gridCount(e.bw, cs)
  const nRows = gridCount(e.bh, cs)
  if (nCols < 1 || nRows < 1) return
  const sx = e.L + (e.bw - nCols * cs) / 2
  const sy = e.T + (e.bh - nRows * cs) / 2
  applyStroke(ctx, e.color, e.dashW, e.style, e.k)
  ctx.beginPath()
  for (let i = 0; i <= nCols; i++) {
    ctx.moveTo(sx + i * cs, sy)
    ctx.lineTo(sx + i * cs, sy + nRows * cs)
  }
  for (let j = 0; j <= nRows; j++) {
    ctx.moveTo(sx, sy + j * cs)
    ctx.lineTo(sx + nCols * cs, sy + j * cs)
  }
  ctx.stroke()
}

// ---------- 点阵纸（网格交点画圆点）----------
// 性能要点：所有圆点累积到**同一条 path**、最后只 fill 一次。若逐点 beginPath+fill，
// A4 默认 5mm 点距有约 38×55 ≈ 2090 个点，会产生两千次状态提交，明显拖慢导出。
// 每个圆点前先 moveTo(圆心+r, 圆心) 起新子路径，否则各点会被直线连成一串。
function drawDianzhen(ctx, o, e) {
  const cs = e.cell * e.k
  if (cs <= 0) return
  const nCols = gridCount(e.bw, cs)
  const nRows = gridCount(e.bh, cs)
  if (nCols < 1 || nRows < 1) return
  const sx = e.L + (e.bw - nCols * cs) / 2
  const sy = e.T + (e.bh - nRows * cs) / 2
  const r = Math.max((e.thumb ? 0.7 : 0.22) * e.k, 0.6)
  ctx.fillStyle = e.color
  ctx.beginPath()
  for (let r2 = 0; r2 <= nRows; r2++) {
    for (let c = 0; c <= nCols; c++) {
      const x = sx + c * cs
      const y = sy + r2 * cs
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
}

// ---------- 空白纸（不绘制任何内容）----------
// ⚠️ 这里是**唯一会合法产出全白图片**的纸型。导出链路的「静默失败检测」若只按
// 「非空白像素占比」判定，会把空白纸的正常输出误报成失败（见 RK-10 / RK-14）。
// 因此导出后回读校验必须结合 blocks[0].type 判断：kongbai 时跳过非空白像素校验，
// 只校验文件尺寸与是否为有效 PNG。改导出校验时务必一并考虑这一条。
function drawKongbai(ctx, o, e) {}

// ---------- 田字格 / 米字格 ----------
function drawTianziMizi(ctx, o, e) {
  const cs = e.cell * e.k
  const nCols = gridCount(e.bw, cs)
  const nRows = gridCount(e.bh, cs)
  if (nCols < 1 || nRows < 1) return
  const sx = e.L + (e.bw - nCols * cs) / 2 // 盒内居中：余量均分两侧
  const sy = e.T + (e.bh - nRows * cs) / 2

  applyStroke(ctx, e.color, e.dashW, e.style, e.k)
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
  applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      ctx.strokeRect(sx + c * cs, sy + r * cs, cs, cs)
    }
  }
}

// ---------- 拼音 / 英语四线三格 ----------
function drawFourLine(ctx, o, e) {
  const rowH = e.cell * e.k
  const gap = 5 * e.k
  let y = e.T
  while (y + rowH <= e.B) {
    for (let i = 0; i < 4; i++) {
      const ly = y + (rowH / 3) * i
      const solid = i === 0 || i === 3 // 上下主线恒为实线
      applyStroke(ctx, e.color, solid ? e.mainW : e.dashW, solid ? 'solid' : e.style, e.k)
      ctx.beginPath()
      ctx.moveTo(e.L, ly)
      ctx.lineTo(e.R, ly)
      ctx.stroke()
    }
    y += rowH + gap
  }
}

// ---------- 拼音田字格（四线条 + 田字行交替） ----------
function drawPinyintian(ctx, o, e) {
  const stripH = 12 * e.k
  const gap = 3 * e.k
  const cs = e.cell * e.k
  let y = e.T
  while (true) {
    // 四线三格条
    if (y + stripH > e.B) break
    for (let i = 0; i < 4; i++) {
      const ly = y + (stripH / 3) * i
      const solid = i === 0 || i === 3
      applyStroke(ctx, e.color, solid ? e.mainW : e.dashW, 'solid', e.k)
      ctx.beginPath()
      ctx.moveTo(e.L, ly)
      ctx.lineTo(e.R, ly)
      ctx.stroke()
    }
    y += stripH + gap
    // 田字格行
    if (y + cs > e.B) break
    const nCols = gridCount(e.bw, cs)
    if (nCols < 1) break
    const sx = e.L + (e.bw - nCols * cs) / 2
    applyStroke(ctx, e.color, e.dashW, e.style, e.k)
    for (let c = 0; c < nCols; c++) {
      const x = sx + c * cs
      ctx.beginPath()
      ctx.moveTo(x + cs / 2, y); ctx.lineTo(x + cs / 2, y + cs)
      ctx.moveTo(x, y + cs / 2); ctx.lineTo(x + cs, y + cs / 2)
      ctx.stroke()
    }
    applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
    for (let c = 0; c < nCols; c++) {
      ctx.strokeRect(sx + c * cs, y, cs, cs)
    }
    y += cs + gap
  }
}

// ---------- 口算纸（空白算式格，支持分栏） ----------
function drawKousuan(ctx, o, e) {
  const gapC = 8 * e.k  // 栏间距
  const ch = 14 * e.k   // 行高
  const colW = (e.bw - (e.cols - 1) * gapC) / e.cols
  const nRows = gridCount(e.bh, ch)
  if (colW <= 0 || nRows < 1) return
  applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
  for (let c = 0; c < e.cols; c++) {
    const x0 = e.L + c * (colW + gapC)
    for (let r = 0; r < nRows; r++) {
      ctx.strokeRect(x0, e.T + r * ch, colW, ch)
    }
  }
}

// ---------- 作文方格纸 ----------
function drawZuowen(ctx, o, e) {
  const cs = e.cell * e.k
  const nCols = gridCount(e.bw, cs)
  const nRows = gridCount(e.bh, cs)
  if (nCols < 1 || nRows < 1) return
  const sx = e.L + (e.bw - nCols * cs) / 2
  const sy = e.T + (e.bh - nRows * cs) / 2
  applyStroke(ctx, e.color, Math.max(0.2 * e.k * e.wt, 0.5), 'solid', e.k)
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
  applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
  ctx.strokeRect(sx, sy, nCols * cs, nRows * cs)
}

// ---------- 控笔纸（虚线曲线描红） ----------
function drawKongbi(ctx, o, e) {
  const gap = e.cell * e.k + 6 * e.k
  let y = e.T + 10 * e.k
  let i = 0
  while (y < e.B - 10 * e.k) {
    const amp = 8 * e.k
    const wl = e.bw / 3
    const up = i % 2 === 0 ? -amp : amp
    applyStroke(ctx, e.color, Math.max(0.45 * e.k * e.wt, 1), 'dash', e.k)
    ctx.setLineDash([2.6 * e.k, 2 * e.k])
    ctx.beginPath()
    ctx.moveTo(e.L, y)
    ctx.quadraticCurveTo(e.L + wl * 0.5, y + up * 1.8, e.L + wl, y)
    ctx.quadraticCurveTo(e.L + wl * 1.5, y - up * 1.8, e.L + wl * 2, y)
    ctx.quadraticCurveTo(e.L + wl * 2.5, y + up * 1.8, e.R, y)
    ctx.stroke()
    // 起笔点
    ctx.setLineDash([])
    ctx.globalAlpha = 0.5
    ctx.fillStyle = e.color
    ctx.beginPath()
    ctx.arc(e.L, y, 1.4 * e.k, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    y += gap
    i++
  }
}

// ---------- 坐标纸（方格，每 5 格加重） ----------
function drawZuobiao(ctx, o, e) {
  const cs = e.cell * e.k
  const nCols = gridCount(e.bw, cs)
  const nRows = gridCount(e.bh, cs)
  if (nCols < 1 || nRows < 1) return
  const sx = e.L + (e.bw - nCols * cs) / 2
  const sy = e.T + (e.bh - nRows * cs) / 2
  const minorW = Math.max((e.thumb ? 0.5 : 0.15) * e.k * e.wt, 0.5)
  const majorW = Math.max((e.thumb ? 0.9 : 0.35) * e.k * e.wt, 0.5)
  const MAJOR = 5 // 每 5 格一条重线

  // 细线（整体降低透明度，避免密格印出来发灰）
  ctx.save()
  ctx.globalAlpha = 0.45
  applyStroke(ctx, e.color, minorW, 'solid', e.k)
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
  applyStroke(ctx, e.color, majorW, 'solid', e.k)
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
function drawWuxianpu(ctx, o, e) {
  const sp = e.cell * e.k       // 谱线间距
  const staffH = sp * 4     // 一个谱表 5 条线 = 4 个间距
  const groupGap = Math.max(sp * 3, 7 * e.k) // 谱表之间留空，便于书写
  if (staffH <= 0) return
  const w = Math.max((e.thumb ? 0.7 : 0.25) * e.k * e.wt, 0.5)
  applyStroke(ctx, e.color, w, 'solid', e.k)
  let y = e.T
  while (y + staffH <= e.B) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const ly = y + sp * i
      ctx.moveTo(e.L, ly)
      ctx.lineTo(e.R, ly)
    }
    ctx.stroke()
    y += staffH + groupGap
  }
}

// ---------- 康奈尔笔记纸（线索栏 + 笔记区 + 总结栏） ----------
function drawKangnaier(ctx, o, e) {
  const rowH = e.cell * e.k
  const topH = 22 * e.k   // 顶部标题区
  const botH = 32 * e.k   // 底部总结区
  const ratio = Math.min(Math.max((o.cue || 30) / 100, 0.1), 0.6)
  if (e.bh < topH + botH + rowH) {
    // 区块太矮，退化为只画外框，不硬塞分区线
    applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
    ctx.strokeRect(e.L, e.T, e.bw, e.bh)
    return
  }
  const bodyT = e.T + topH
  const bodyB = e.B - botH
  const cueX = e.L + e.bw * ratio

  // 外框
  applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
  ctx.strokeRect(e.L, e.T, e.bw, e.bh)
  // 标题区底线、总结区顶线、线索栏竖线（均实线）
  applyStroke(ctx, e.color, e.mainW, 'solid', e.k)
  ctx.beginPath()
  ctx.moveTo(e.L, bodyT); ctx.lineTo(e.R, bodyT)
  ctx.moveTo(e.L, bodyB); ctx.lineTo(e.R, bodyB)
  ctx.moveTo(cueX, bodyT); ctx.lineTo(cueX, bodyB)
  ctx.stroke()
  // 笔记区横线（跟随线型；横线通栏，含线索栏）
  const nRows = gridCount(bodyB - bodyT, rowH)
  if (nRows > 0) {
    applyStroke(ctx, e.color, e.dashW, e.style, e.k)
    ctx.beginPath()
    for (let i = 1; i <= nRows; i++) {
      const ly = bodyT + i * rowH
      if (ly > bodyB - 0.5) break
      ctx.moveTo(e.L, ly)
      ctx.lineTo(e.R, ly)
    }
    ctx.stroke()
  }
}

// ---------- 周计划表（7 列 × N 行，含星期表头） ----------
function drawZhoujihua(ctx, o, e) {
  const rowH = e.cell * e.k
  const rows = Math.round(o.rows || 8)
  const nCols = 7
  const headH = Math.max(rowH * 0.9, 10 * e.k)
  const colW = e.bw / nCols
  if (colW <= 0 || rowH <= 0) return
  const headBottom = e.T + headH
  const dataBottom = Math.min(headBottom + rows * rowH, e.B)

  // 外框
  applyStroke(ctx, e.color, e.frameW, 'solid', e.k)
  ctx.strokeRect(e.L, e.T, e.bw, e.bh)
  // 列分隔线（含表头）
  applyStroke(ctx, e.color, e.dashW, e.style, e.k)
  ctx.beginPath()
  for (let c = 1; c < nCols; c++) {
    const x = e.L + c * colW
    ctx.moveTo(x, e.T)
    ctx.lineTo(x, dataBottom)
  }
  ctx.stroke()
  // 行分隔线
  ctx.beginPath()
  for (let r = 1; r <= rows; r++) {
    const ly = headBottom + r * rowH
    if (ly > e.B + 0.01) break
    ctx.moveTo(e.L, ly)
    ctx.lineTo(e.R, ly)
  }
  ctx.stroke()
  // 表头底线（实线，与内容区分隔更清楚）
  applyStroke(ctx, e.color, e.mainW, 'solid', e.k)
  ctx.beginPath()
  ctx.moveTo(e.L, headBottom)
  ctx.lineTo(e.R, headBottom)
  ctx.stroke()

  // 星期文字：逐格 clip，防止窄列时溢出到相邻列
  ctx.save()
  ctx.fillStyle = e.color
  ctx.font = `${Math.max(4.2 * e.k, 9)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const names = ['一', '二', '三', '四', '五', '六', '日']
  for (let c = 0; c < nCols; c++) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(e.L + c * colW, e.T, colW, headH)
    ctx.clip()
    ctx.fillText(`周${names[c]}`, e.L + c * colW + colW / 2, headBottom - headH / 2)
    ctx.restore()
  }
  ctx.restore()
}

// ---------- 注册表：纸型 → 绘制函数 ----------
// 新增纸型只需在此登记一行 + 实现一个函数；未登记的纸型不绘制（与原 if 链落空行为一致）
const TYPE_DRAWERS = {
  hengxian: drawHengxian,
  shuxian: drawShuxian,
  fangge: drawFangge,
  dianzhen: drawDianzhen,
  kongbai: drawKongbai,
  tianzige: drawTianziMizi,
  mizige: drawTianziMizi,
  pinyin: drawFourLine,
  english: drawFourLine,
  pinyintian: drawPinyintian,
  kousuan: drawKousuan,
  zuowen: drawZuowen,
  kongbi: drawKongbi,
  zuobiao: drawZuobiao,
  wuxianpu: drawWuxianpu,
  kangnaier: drawKangnaier,
  zhoujihua: drawZhoujihua,
}

/**
 * 在一个「盒子」内绘制一种纸型
 * o: {
 *   box: {x, y, w, h},   // 像素，已是内容区
 *   type, cell(mm), color, style, cols,    // 区块参数
 *   cue, rows,                             // 纸型专属参数（康奈尔 / 周计划）
 *   pxPerMm,                               // dpi / 25.4
 *   thumb,                                 // 缩略图模式：加粗线宽便于小尺寸辨识
 *   weight                                 // v1.2 线条粗细倍率（1 = 不变，缺省按 1 处理）
 * }
 */
function drawBlock(ctx, o) {
  const box = o.box

  // 公共环境：盒坐标、三档线宽（外框 0.3mm、内虚线 0.28mm、主线 0.35mm；缩略图加粗；低于 0.5px 兜底）
  // v1.2：统一乘 weight 倍率。wt=1 时 x*k*1 与 x*k 浮点恒等，输出逐像素不变
  const k = o.pxPerMm
  const thumb = !!o.thumb
  const wt = o.weight || 1 // 缺省 1：所有旧调用方不传时逐像素不变
  const e = {
    L: box.x,
    T: box.y,
    R: box.x + box.w,
    B: box.y + box.h,
    bw: box.w,
    bh: box.h,
    k,
    color: o.color,
    style: o.style,
    cols: o.cols || 1,
    cell: o.cell,
    thumb,
    wt,
    frameW: Math.max((thumb ? 0.8 : 0.3) * k * wt, 0.5),
    dashW: Math.max((thumb ? 0.6 : 0.28) * k * wt, 0.5),
    mainW: Math.max((thumb ? 0.9 : 0.35) * k * wt, 0.5),
  }

  const fn = TYPE_DRAWERS[o.type]
  if (fn) fn(ctx, o, e)
}

// ---------- v1.2 形式层（drawPage 内的叠加层）----------

/**
 * 背景纹理：满铺浅色图案，用线色的低透明度呈现（不单独占参数）。
 * 画在整张纸（含页边距区），因为它是「纸本身的底纹」，不是内容区装饰。
 */
function drawTexture(ctx, W, H, k, texture, color) {
  if (!texture || texture === 'none') return
  ctx.save()
  ctx.globalAlpha = 0.12
  const s = 5 * k
  if (texture === 'dots') {
    // 点阵：与点阵纸同构——全部累积到一条 path，只 fill 一次（满幅约 40×70 点）
    ctx.fillStyle = color
    const r = Math.max(0.3 * k, 0.5)
    ctx.beginPath()
    for (let y = s; y < H; y += s) {
      for (let x = s; x < W; x += s) {
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  } else {
    applyStroke(ctx, color, Math.max(0.2 * k, 0.5), 'solid', k)
    ctx.beginPath()
    if (texture === 'grid' || texture === 'lines') {
      for (let y = s; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    }
    if (texture === 'grid') {
      for (let x = s; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    }
    if (texture === 'cross') {
      const step = s * 2
      for (let x = -H; x < W + H; x += step) {
        ctx.moveTo(x, 0); ctx.lineTo(x + H, H)
        ctx.moveTo(x, H); ctx.lineTo(x + H, 0)
      }
    }
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 页面边框：画在页缘内缩 4mm 处（内容区之外，不与格线抢位置）。
 * double 为书法双线框：外粗内细。
 */
function drawBorder(ctx, W, H, k, style, color, weight) {
  if (!style || style === 'none') return
  const wt = weight || 1
  const inset = 4 * k
  if (style === 'single') {
    applyStroke(ctx, color, Math.max(0.35 * k * wt, 0.5), 'solid', k)
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
  } else if (style === 'double') {
    applyStroke(ctx, color, Math.max(0.9 * k * wt, 0.8), 'solid', k)
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
    const i2 = inset + 3 * k
    applyStroke(ctx, color, Math.max(0.25 * k * wt, 0.5), 'solid', k)
    ctx.strokeRect(i2, i2, W - i2 * 2, H - i2 * 2)
  } else if (style === 'bold') {
    applyStroke(ctx, color, Math.max(1.4 * k * wt, 1), 'solid', k)
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
  }
}

/**
 * 文字水印：页面中央单条旋转文字，最后绘制（压在内容之上）。
 * 字号随字数自适应（字多字小），上下限防极端。
 */
function drawWatermark(ctx, W, H, k, o) {
  const text = (o.text || '').trim()
  if (!text) return
  const alpha = o.alpha === undefined ? 0.12 : o.alpha
  const angle = o.angle === undefined ? -45 : o.angle
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = o.color
  ctx.translate(W / 2, H / 2)
  ctx.rotate((angle * Math.PI) / 180)
  const span = Math.min(W, H)
  let fs = (span * 0.85) / Math.max(text.length, 1)
  fs = Math.min(Math.max(fs, 6 * k), span * 0.4)
  ctx.font = `${fs}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/**
 * 绘制整页：背景色 → 背景纹理 → 按版式逐区块 clip 绘制 → 页面边框 → 文字水印
 * o: {
 *   size, orient, margin, color, style, layout, blocks,
 *   weight, bgColor, bgTexture, border, wmText, wmAlpha, wmAngle,   // v1.2 形式层（均可缺省，缺省=旧版表现）
 *   widthPx, heightPx, pxPerMm, thumb
 * }
 */
function drawPage(ctx, o) {
  const k = o.pxPerMm
  const W = o.widthPx
  const H = o.heightPx
  const weight = o.weight || 1

  // ① 背景色：默认纯白，与 v1.1 及之前逐像素一致
  ctx.save()
  ctx.fillStyle = o.bgColor || '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  // ② 背景纹理：默认无
  drawTexture(ctx, W, H, k, o.bgTexture, o.color)

  // ③ 区块内容
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
      weight,
    })
    ctx.restore()
  })

  // ④ 页面边框：默认无
  drawBorder(ctx, W, H, k, o.border, o.color, weight)

  // ⑤ 文字水印：默认无
  drawWatermark(ctx, W, H, k, { text: o.wmText, alpha: o.wmAlpha, angle: o.wmAngle, color: o.color })
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
    weight: o.weight,
    bgColor: o.bgColor,
    bgTexture: o.bgTexture,
    border: o.border,
    wmText: o.wmText,
    wmAlpha: o.wmAlpha,
    wmAngle: o.wmAngle,
    layout: papers.DEFAULT_LAYOUT,
    blocks: [{ type: o.type, cell: o.cell, cols: o.cols, cue: o.cue, rows: o.rows }],
    widthPx: o.widthPx,
    heightPx: o.heightPx,
    pxPerMm: o.pxPerMm,
    thumb: o.thumb,
  })
}

module.exports = { drawPage, drawBlock, drawPaper, dashPattern, applyStroke, drawTexture, drawBorder, drawWatermark }
