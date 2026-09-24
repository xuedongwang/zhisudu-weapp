// utils/papers.js
// 纸型 / 纸张规格 / 版式 定义的**单一数据源**。
//
// 参数结构（v1.1 起，页面级 + 区块级两层）：
//   {
//     size, orient, margin, color, style,        // 页面级
//     layout,                                    // 版式：1x1 / 2x1 / 3x1 / 2x2
//     blocks: [ { type, cell, cols?, ...extra } ] // 区块级，数组长度由 layout 决定
//   }
// 旧的扁平结构（{type, cell, margin, color, style, cols, orient}）仍被完全支持：
// normalizeParams() 会把它升级为「单区块整页」，因此存量模板 / 最近记录 / 打印历史无需迁移。
//
// ⚠️ 为什么 color/style 放在页面级而不是区块级：一页纸通常只用一种笔色，
// 放页面级能让「换颜色」只改一次；若放区块级，四宫格要改 4 次。cell/cols/extra 才随纸型走。

// ---------- 纸张规格（FR-17）----------
// A4 与既有实现逐值一致（300DPI = 2480×3508），扩展规格按 mm×dpi/25.4 现算
const SIZES = [
  { key: 'a4', name: 'A4', widthMm: 210, heightMm: 297, note: '打印店默认' },
  { key: 'k16', name: '16K', widthMm: 185, heightMm: 260, note: '作业本常用' },
  { key: 'b5', name: 'B5', widthMm: 176, heightMm: 250, note: '作业本常用' },
  { key: 'a5', name: 'A5', widthMm: 148, heightMm: 210, note: '半张 A4' },
]
const DEFAULT_SIZE = 'a4'

// ---------- 版式（FR-18 单页多区块）----------
// 命名按「行 × 列」，区块顺序为行优先（从左到右、从上到下）
const BLOCK_GAP_MM = 6 // 区块间距，固定值：不开放为参数，避免参数无限膨胀

const LAYOUTS = [
  { key: '1x1', name: '整页', rows: 1, cols: 1, desc: '一张纸一种纸型' },
  { key: '2x1', name: '上下两格', rows: 2, cols: 1, desc: '如上半练字、下半注音' },
  { key: '3x1', name: '上下三格', rows: 3, cols: 1, desc: '如拼音、练字、口算' },
  { key: '2x2', name: '四宫格', rows: 2, cols: 2, desc: '四区各自选纸型' },
]
const DEFAULT_LAYOUT = '1x1'

function blockCount(layoutKey) {
  const l = LAYOUTS.find((x) => x.key === layoutKey) || LAYOUTS[0]
  return l.rows * l.cols
}

function findLayout(layoutKey) {
  return LAYOUTS.find((x) => x.key === layoutKey) || LAYOUTS[0]
}

function findSize(sizeKey) {
  return SIZES.find((x) => x.key === sizeKey) || SIZES[0]
}

// 纸张 mm 尺寸（横向时宽高互换）
function pageSizeMm(sizeKey, orient) {
  const s = findSize(sizeKey)
  return orient === 'l'
    ? { w: s.heightMm, h: s.widthMm }
    : { w: s.widthMm, h: s.heightMm }
}

/**
 * 版面盒子：把一张纸的内容区切成 layout 指定的若干区块
 * 返回值顺序 = 区块下标顺序（行优先），可直接与 blocks 数组按下标对应
 *
 * 单位无关：mm 与 px 都可用（绘制时传 px 值，保证与画布实际像素对齐，不引入取整误差）。
 * 1x1 时结果恒为 { margin, margin, width-2*margin, height-2*margin }，
 * 这正是重构前 drawPaper 使用的 m / uw / uh —— 单区块输出因此逐像素不变。
 */
function layoutBoxes(layoutKey, width, height, margin, gap) {
  const l = findLayout(layoutKey)
  // 边距上限保护：极端参数下不让内容区塌成 0 或负数
  const lim = Math.min(width, height) * 0.45
  const m = Math.min(Math.max(Number(margin) || 0, 0), lim)
  const g = gap === undefined ? BLOCK_GAP_MM : (Number(gap) || 0)
  const areaW = width - m * 2
  const areaH = height - m * 2
  const bw = (areaW - (l.cols - 1) * g) / l.cols
  const bh = (areaH - (l.rows - 1) * g) / l.rows
  const out = []
  for (let r = 0; r < l.rows; r++) {
    for (let c = 0; c < l.cols; c++) {
      out.push({
        x: m + c * (bw + g),
        y: m + r * (bh + g),
        w: bw,
        h: bh,
      })
    }
  }
  return out
}

// ---------- 纸型分类（FR-01 首页分组）----------
// 原首页区块标题写死「儿童场景纸」，新增中学 / 成人向纸型后会名不副实，故改为按用途分类
// v1.1 新增「基础纸型」并**置于最前**：它是使用频次最高的一组，也是对标 PaperMe 后
// 补上的最大缺口（详见《功能扩展方向评估》12.4 发现 1）
const CATEGORIES = [
  { key: 'jichu', name: '基础纸型' },
  { key: 'lianzi', name: '练字与书写' },
  { key: 'xueke', name: '学科作业' },
  { key: 'yinyue', name: '音乐乐谱' },
  { key: 'biji', name: '笔记与计划' },
]

// ---------- 纸型定义 ----------
// cell: 可调主参数（格宽/行高/线距），单位 mm，{min, max, def, step, label}
// hasCols: 是否支持分栏选纸（仅口算纸）
// short: 短名（2-3 字），用于多区块的区块选择条等窄位显示
// extra: 纸型专属参数（FR-02.7）——原先 defaultParams 只认固定 6 个字段，
//        坐标纸细分、康奈尔线索栏比例等无处安放；改为纸型可声明自己的额外可调项
const PAPERS = {
  // ---------- 基础纸型（v1.1 新增）----------
  // 对标 PaperMe 后补的最基础缺口：原先 12 种全是书法格与作业纸，相当于
  // 「只卖书法纸和作业纸，不卖最普通的横线本」。默认值取市面常见规格：
  // 横线本行距 8mm、方格本 5mm、点阵本 5mm。
  hengxian: {
    key: 'hengxian',
    name: '横线纸',
    short: '横线',
    category: 'jichu',
    desc: '日常笔记 · 默认行距 8mm',
    cell: { min: 5, max: 12, def: 8, step: 0.5, label: '行距' },
  },
  shuxian: {
    key: 'shuxian',
    name: '竖线纸',
    short: '竖线',
    category: 'jichu',
    desc: '竖排书写 · 默认列距 8mm',
    cell: { min: 5, max: 12, def: 8, step: 0.5, label: '列距' },
  },
  fangge: {
    key: 'fangge',
    name: '方格纸',
    short: '方格',
    category: 'jichu',
    desc: '计算与绘图 · 默认格宽 5mm',
    cell: { min: 3, max: 12, def: 5, step: 0.5, label: '格宽' },
  },
  dianzhen: {
    key: 'dianzhen',
    name: '点阵纸',
    short: '点阵',
    category: 'jichu',
    desc: '画图与规划 · 默认点距 5mm',
    cell: { min: 3, max: 12, def: 5, step: 0.5, label: '点距' },
  },
  // ⚠️ 全库**唯一没有 cell 的纸型**：空白纸没有任何可调尺寸。
  // 早先所有纸型都假定必有 cell，normalizeBlock / describeBlock / config 页等地
  // 都无保护地读 p.cell —— 因此本次一并加了「cell 可选」支持（各处判空）。
  // **不要把 cell 硬塞给它**：那会在配置页多出一个拖了没反应的滑杆，比没有更糟。
  kongbai: {
    key: 'kongbai',
    name: '空白纸',
    short: '空白',
    category: 'jichu',
    desc: '纯白页 · 自由书写或绘画',
  },

  // ---------- 练字与书写 ----------
  tianzige: {
    key: 'tianzige',
    name: '田字格',
    short: '田字',
    category: 'lianzi',
    desc: '汉字练习 · 默认格宽 12mm',
    cell: { min: 8, max: 20, def: 12, step: 0.5, label: '格宽' },
  },
  mizige: {
    key: 'mizige',
    name: '米字格',
    short: '米字',
    category: 'lianzi',
    desc: '笔顺定位 · 默认格宽 14mm',
    cell: { min: 8, max: 20, def: 14, step: 0.5, label: '格宽' },
  },
  pinyin: {
    key: 'pinyin',
    name: '拼音四线三格',
    short: '拼音',
    category: 'lianzi',
    desc: '拼音书写 · 默认行高 18mm',
    cell: { min: 12, max: 24, def: 18, step: 0.5, label: '行高' },
  },
  pinyintian: {
    key: 'pinyintian',
    name: '拼音田字格',
    short: '拼田',
    category: 'lianzi',
    desc: '四线 + 田字格组合 · 默认格宽 12mm',
    cell: { min: 10, max: 18, def: 12, step: 0.5, label: '格宽' },
  },
  english: {
    key: 'english',
    name: '英语四线三格',
    short: '英语',
    category: 'lianzi',
    desc: '英文书写 · 默认行高 15mm',
    cell: { min: 10, max: 22, def: 15, step: 0.5, label: '行高' },
  },
  zuowen: {
    key: 'zuowen',
    name: '作文方格纸',
    short: '作文',
    category: 'lianzi',
    desc: '400 格/页（估算） · 默认格宽 8mm',
    cell: { min: 7, max: 10, def: 8, step: 0.5, label: '格宽' },
  },
  kongbi: {
    key: 'kongbi',
    name: '控笔纸',
    short: '控笔',
    category: 'lianzi',
    desc: '曲线描红 · 运笔训练',
    cell: { min: 8, max: 20, def: 12, step: 0.5, label: '线距' },
  },
  kousuan: {
    key: 'kousuan',
    name: '口算纸',
    short: '口算',
    category: 'xueke',
    desc: '空白算式格 · 支持分栏',
    cell: { min: 14, max: 28, def: 20, step: 0.5, label: '格宽' },
    hasCols: true,
  },
  zuobiao: {
    key: 'zuobiao',
    name: '坐标纸',
    short: '坐标',
    category: 'xueke',
    desc: '直角坐标系 · 每 5 格加重 · 默认 5mm',
    cell: { min: 4, max: 15, def: 5, step: 0.5, label: '格宽' },
  },
  wuxianpu: {
    key: 'wuxianpu',
    name: '五线谱纸',
    short: '五线谱',
    category: 'yinyue',
    desc: '五行谱表 · 默认线距 2.5mm',
    cell: { min: 1.5, max: 4, def: 2.5, step: 0.5, label: '谱线间距' },
  },
  kangnaier: {
    key: 'kangnaier',
    name: '康奈尔笔记纸',
    short: '康奈尔',
    category: 'biji',
    desc: '线索栏 + 笔记区 + 总结栏 · 默认行高 9mm',
    cell: { min: 7, max: 14, def: 9, step: 0.5, label: '行高' },
    extra: [
      { key: 'cue', label: '线索栏宽', def: 30, min: 20, max: 40, step: 5, unit: '%' },
    ],
  },
  zhoujihua: {
    key: 'zhoujihua',
    name: '周计划表',
    short: '周计划',
    category: 'biji',
    desc: '周一到周日 7 列 · 默认行高 12mm',
    cell: { min: 8, max: 20, def: 12, step: 1, label: '行高' },
    extra: [
      { key: 'rows', label: '行数', def: 8, min: 4, max: 12, step: 1, unit: '行' },
    ],
  },
}

// 线条颜色
const COLORS = [
  { value: '#333333', name: '黑' },
  { value: '#9A9A92', name: '灰' },
  { value: '#D9534F', name: '红' },
  { value: '#3B6FB5', name: '蓝' },
  { value: '#2E8B57', name: '绿' },
]

// 线条样式
const STYLES = [
  { value: 'solid', name: '实线' },
  { value: 'dash', name: '虚线' },
  { value: 'dot', name: '点线' },
]

// 兼容保留：A4 尺寸常量（旧代码引用）
const A4 = { widthMm: SIZES[0].widthMm, heightMm: SIZES[0].heightMm }

// ---------- 默认值 ----------

// 区块默认参数（含纸型专属参数）
function defaultBlock(key) {
  const p = PAPERS[key] || PAPERS.tianzige
  const b = { type: p.key }
  // p.cell 可缺省（空白纸）：缺省时不写 cell，避免留下一个无意义的参数键
  if (p.cell) b.cell = p.cell.def
  if (p.hasCols) b.cols = 2
  ;(p.extra || []).forEach((e) => { b[e.key] = e.def })
  return b
}

// 整页默认参数（单区块）
function defaultParams(key) {
  return {
    size: DEFAULT_SIZE,
    orient: 'p',
    margin: 10,
    color: COLORS[0].value,
    style: STYLES[0].value,
    layout: DEFAULT_LAYOUT,
    blocks: [defaultBlock(key || 'tianzige')],
  }
}

// ---------- 归一化（新旧结构统一入口）----------

function clampNum(v, min, max, def) {
  const n = Number(v)
  if (isNaN(n)) return def
  return Math.min(Math.max(n, min), max)
}

function clampInt(v, min, max, def) {
  return Math.round(clampNum(v, min, max, def))
}

function normalizeBlock(raw, fallbackType) {
  const src = raw || {}
  const type = PAPERS[src.type] ? src.type : (PAPERS[fallbackType] ? fallbackType : 'tianzige')
  const p = PAPERS[type]
  const out = { type }
  // p.cell 可缺省（空白纸）：有才归一化。若无条件写 cell，会给无参纸型凭空造出一个
  // 参数键，进而污染 signature 去重与 describeBlock 文案
  if (p.cell) out.cell = clampNum(src.cell, p.cell.min, p.cell.max, p.cell.def)
  if (p.hasCols) out.cols = clampInt(src.cols, 1, 3, 2)
  ;(p.extra || []).forEach((e) => { out[e.key] = clampNum(src[e.key], e.min, e.max, e.def) })
  return out
}

/**
 * 把任意历史形态的参数归一化为当前结构。
 * - 旧扁平结构（无 blocks）→ 升级为单区块整页，存量数据无需迁移
 * - 区块数量按 layout 校正（多退少补），避免脏数据导致绘制越界
 */
function normalizeParams(raw, fallbackType) {
  const src = raw || {}
  const legacy = !Array.isArray(src.blocks)

  const size = findSize(src.size).key
  const orient = src.orient === 'l' ? 'l' : 'p'
  const margin = clampNum(src.margin, 5, 25, 10)
  const color = COLORS.some((c) => c.value === src.color) ? src.color : COLORS[0].value
  const style = STYLES.some((s) => s.value === src.style) ? src.style : STYLES[0].value
  // 旧结构必然是单区块，强制 1x1
  const layout = legacy ? DEFAULT_LAYOUT : findLayout(src.layout).key

  const seed = legacy ? src.type : (src.blocks[0] && src.blocks[0].type)
  const fb = PAPERS[seed] ? seed : (PAPERS[fallbackType] ? fallbackType : 'tianzige')

  // ⚠️ 旧结构下整页参数里**没有 blocks 数组**，纸型参数就平铺在最外层——
  //    必须把 src 本身当作区块来源，否则 cell/cols 会被静默丢弃、一律回落默认值
  //    （存量模板与打印历史的参数会集体失真）。这一条由自测覆盖。
  let blocks = legacy
    ? [normalizeBlock(src, fb)]
    : (Array.isArray(src.blocks) ? src.blocks : []).map((b) => normalizeBlock(b, fb))
  const need = blockCount(layout)
  if (!blocks.length) blocks = [defaultBlock(fb)]
  while (blocks.length < need) blocks.push(normalizeBlock({ type: blocks[0].type }, blocks[0].type))
  if (blocks.length > need) blocks = blocks.slice(0, need)

  return { size, orient, margin, color, style, layout, blocks }
}

// 去重签名：固定键序，保证同一配置不同来源得到同一签名
function signature(raw) {
  const n = normalizeParams(raw)
  const blocks = n.blocks.map((b) => {
    const o = { type: b.type }
    // cell 可缺省（空白纸）：缺省时不写该键——JSON.stringify 会丢掉 undefined，
    // 显式判断只是让「键序」在两种情况下都确定，避免去重签名出现两种等价写法
    if (b.cell !== undefined) o.cell = b.cell
    if (b.cols !== undefined) o.cols = b.cols
    Object.keys(b).sort().forEach((k) => {
      if (k !== 'type' && k !== 'cell' && k !== 'cols') o[k] = b[k]
    })
    return o
  })
  return JSON.stringify({
    size: n.size, orient: n.orient, margin: n.margin,
    color: n.color, style: n.style, layout: n.layout, blocks,
  })
}

// ---------- 存储条目归一化 ----------

// 把一条存量记录（模板 / 最近生成 / 打印历史）升级成当前结构。
// 旧条目没有 layout，归一化后自然是 1x1。
// 迁到 papers.js 的原因：v1.2.0 起 utils/store.js 与 utils/sync.js 都要用它做
// 去重与合并，若留在 store.js 里，sync 只能复制一份（改一处漏一处）。
function normalizeEntry(e, legacyType) {
  const params = normalizeParams(e && e.params, (e && e.type) || legacyType)
  return {
    ...e,
    params,
    type: params.blocks[0].type, // 兼容字段：旧调用方按 type 取值
    types: params.blocks.map((b) => b.type),
    layout: params.layout,
  }
}

// ---------- 展示文案 ----------

function colorName(v) {
  const c = COLORS.find((x) => x.value === v)
  return c ? `${c.name}色` : ''
}

function styleName(v) {
  const s = STYLES.find((x) => x.value === v)
  return s ? s.name : ''
}

// 区块文案：主行「纸型 · 参数」，如「田字格 · 格宽12mm」
// 无 cell 的纸型（空白纸）只有纸型名，不拼参数——拼一个不存在的参数会得到「undefinedmm」
function describeBlock(rawBlock) {
  const b = normalizeBlock(rawBlock, rawBlock && rawBlock.type)
  const p = PAPERS[b.type]
  const parts = []
  if (p.cell) parts.push(`${p.cell.label}${b.cell}mm`)
  if (p.hasCols) parts.push(`${b.cols}栏`)
  ;(p.extra || []).forEach((e) => { parts.push(`${e.label}${b[e.key]}${e.unit || ''}`) })
  const title = parts.length ? `${p.name} · ${parts[0]}` : p.name
  return { title, parts, sub: parts.slice(1).join(' · ') }
}

/**
 * 整页文案（列表 / 模板名 / 历史条目共用）
 * 单区块：主行「田字格 · 格宽12mm」，副行「A4纵向 · 黑色 · 实线」
 * 多区块：主行「四宫格 · 田字格 / 口算纸」，副行「A4纵向 · 4 区 · 黑色 · 实线」
 */
function describePage(raw) {
  const n = normalizeParams(raw)
  const s = findSize(n.size)
  const l = findLayout(n.layout)
  const orientText = n.orient === 'l' ? '横' : '纵'

  let title
  if (n.layout === '1x1') {
    const p = PAPERS[n.blocks[0].type]
    // 无 cell 的纸型（空白纸）只给纸型名，不拼参数
    title = p.cell ? `${p.name} · ${p.cell.label}${n.blocks[0].cell}mm` : p.name
  } else {
    const names = n.blocks.map((b) => PAPERS[b.type].name)
    title = `${l.name} · ${names.join(' / ')}`
  }

  const sub = [`${s.name}${orientText}`]
  if (n.layout !== '1x1') sub.push(`${n.blocks.length} 区`)
  if (n.blocks[0] && PAPERS[n.blocks[0].type].hasCols) sub.push(`${n.blocks[0].cols}栏`)
  const cn = colorName(n.color)
  if (cn) sub.push(cn)
  const sn = styleName(n.style)
  if (sn) sub.push(sn)

  return { title, sub: sub.join(' · '), size: s, layout: l }
}

// 模板规范名（列表内可区分：含规格与方向）
function templateName(raw) {
  const d = describePage(raw)
  const n = normalizeParams(raw)
  return `${d.title} · ${d.size.name}${n.orient === 'l' ? '横' : '纵'}`
}

// 首页分组：按 CATEGORIES 顺序返回 [{key, name, papers:[...]}]
function groupedPapers() {
  return CATEGORIES.map((c) => ({
    key: c.key,
    name: c.name,
    papers: Object.keys(PAPERS)
      .filter((k) => PAPERS[k].category === c.key)
      .map((k) => ({ key: k, name: PAPERS[k].name, desc: PAPERS[k].desc })),
  })).filter((g) => g.papers.length)
}

// 导出规格文案（像素按 dpi 现算）
function pixelSize(sizeKey, orient, dpi) {
  const mm = pageSizeMm(sizeKey, orient)
  const k = dpi / 25.4
  return { w: Math.round(mm.w * k), h: Math.round(mm.h * k) }
}

module.exports = {
  PAPERS, CATEGORIES, COLORS, STYLES, SIZES, LAYOUTS, A4,
  DEFAULT_SIZE, DEFAULT_LAYOUT, BLOCK_GAP_MM,
  blockCount, findLayout, findSize, pageSizeMm, layoutBoxes,
  defaultBlock, defaultParams, normalizeBlock, normalizeParams, normalizeEntry, signature,
  describeBlock, describePage, templateName, groupedPapers, pixelSize,
}
