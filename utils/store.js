// utils/store.js
// 本地存储：自定义模板 / 纸型收藏 / 最近生成记录 / 打印历史（PRD FR-09/10/11/16）
// 本机是主存储，无网也完整可用；v1.2.0 起每次写入会异步同步一份到云端（utils/sync.js）。
//
// v1.1 参数结构升级：统一存「整页参数」（size/orient/margin/color/style/layout/blocks）。
// 存量数据是旧的扁平结构（{type, cell, margin, ...}），**不迁移、不写坏**——
// 读取时统一走 papers.normalizeParams 归一化，写回时才落新结构，升级对老用户透明。

const papers = require('./papers')
const { KEYS, LIMITS } = require('./schema')
const sync = require('./sync')

const TEMPLATE_LIMIT = LIMITS.templates
const RECENT_LIMIT = LIMITS.recent
const HISTORY_LIMIT = LIMITS.history

const MULTI_KEY = '__multi__' // 多区块页在纸型分布里的归类键
const BATCH_KEY = '__batch__' // v1.5 批量任务在纸型分布里的归类键

// ---------- 归一化辅助 ----------

// 归一化实现已上移到 papers.normalizeEntry（sync.js 做合并时也要用同一份逻辑）
function normalizeEntry(e, legacyType) {
  return papers.normalizeEntry(e, legacyType)
}

// ---------- 自定义模板 ----------
function getTemplates() {
  return (wx.getStorageSync(KEYS.templates) || []).map((t) => normalizeEntry(t))
}

// 模板规范名（含规格与方向，保证列表内可区分）
function buildTemplateName(raw) {
  return papers.templateName(raw)
}

// 列表展示文案：主行＝纸型/版式＋核心尺寸，副行＝规格/方向/栏数/线色/线型
function describeTemplate(raw) {
  const d = papers.describePage(raw)
  return { title: d.title, sub: d.sub }
}

// 保存模板；入参为整页参数；返回 {ok, message}
function saveTemplate(raw) {
  const list = getTemplates()
  if (list.length >= TEMPLATE_LIMIT) {
    return { ok: false, message: `模板已满（${TEMPLATE_LIMIT} 个），请删除后再保存` }
  }
  const params = papers.normalizeParams(raw)
  // 整页同配置视为同一模板：原先无去重，连点两次会存出两条完全一样的模板
  const sig = papers.signature(params)
  if (list.some((t) => papers.signature(t.params) === sig)) {
    return { ok: false, message: '该配置已存为模板，无需重复保存' }
  }
  const tpl = {
    id: `t_${Date.now()}`,
    type: params.blocks[0].type,
    name: buildTemplateName(params),
    params,
    createdAt: Date.now(),
  }
  list.unshift(tpl)
  wx.setStorageSync(KEYS.templates, list)
  sync.afterWrite('templates')
  return { ok: true, message: '已存为模板' }
}

// 就地更新模板（从模板入口编辑后覆盖原模板，保留 id 与 createdAt）；返回 {ok, message}
function updateTemplate(id, raw) {
  const list = getTemplates()
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) return { ok: false, message: '模板不存在，可能已被删除' }
  const params = papers.normalizeParams(raw)
  const t = list[idx]
  list[idx] = {
    ...t,
    type: params.blocks[0].type,
    name: buildTemplateName(params),
    params,
    updatedAt: Date.now(),
  }
  wx.setStorageSync(KEYS.templates, list)
  sync.afterWrite('templates')
  return { ok: true, message: '已更新模板' }
}

function deleteTemplate(id) {
  const list = getTemplates().filter((t) => t.id !== id)
  wx.setStorageSync(KEYS.templates, list)
  sync.afterWrite('templates')
}

// 按当前命名规则重算存量模板名称（幂等；命名规则升级后进入「我的」页时调用）
function syncTemplateNames() {
  const list = getTemplates()
  let changed = false
  const next = list.map((t) => {
    const name = buildTemplateName(t.params)
    if (t.name === name) return t
    changed = true
    return { ...t, name }
  })
  if (changed) {
    wx.setStorageSync(KEYS.templates, next)
    // 只是重命名，但名称也是模板数据的一部分——不推的话另一台设备看到的还是旧名
    sync.afterWrite('templates')
  }
  return next
}

function findTemplate(id) {
  return getTemplates().find((t) => t.id === id) || null
}

// ---------- 纸型收藏 ----------
function getFavs() {
  return wx.getStorageSync(KEYS.favs) || []
}

function isFav(type) {
  return getFavs().indexOf(type) > -1
}

function toggleFav(type) {
  let list = getFavs()
  if (list.indexOf(type) > -1) {
    list = list.filter((k) => k !== type)
  } else {
    list.unshift(type)
  }
  wx.setStorageSync(KEYS.favs, list)
  sync.afterWrite('favs')
  return list
}

// ---------- 最近生成记录 ----------
function getRecent() {
  return (wx.getStorageSync(KEYS.recent) || []).map((r) => normalizeEntry(r))
}

function pushRecent(raw) {
  const params = papers.normalizeParams(raw)
  let list = getRecent()
  // 同配置去重：整页参数一致则移除旧记录，新记录置顶
  const sig = papers.signature(params)
  list = list.filter((r) => papers.signature(r.params) !== sig)
  list.unshift({ type: params.blocks[0].type, params, time: Date.now() })
  if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT)
  wx.setStorageSync(KEYS.recent, list)
  sync.afterWrite('recent')
}

// ---------- 打印历史（FR-16） ----------
// 与「最近记录」职责不同，二者并存、互不影响：
//   recent  —— 同配置去重、上限 10，是「参数复用快捷入口」（首页「再次生成」用）
//   history —— 每次导出各记一条、上限 50，是「行为流水」（复访沉淀、使用统计用）
// 之所以不合并：合并会互相伤害——去重后看不出打印频次，按次记录又会让「再次生成」
// 被同一张纸刷屏；两种语义本就该分开存。
function getHistory() {
  return (wx.getStorageSync(KEYS.history) || []).map((h) => normalizeEntry(h))
}

// 记录一次成功的导出；返回最新列表
function pushHistory(raw, meta) {
  const params = papers.normalizeParams(raw)
  let list = getHistory()
  list.unshift({
    id: `h_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type: params.blocks[0].type,
    types: params.blocks.map((b) => b.type),
    layout: params.layout,
    params,
    time: Date.now(),
    dpi: (meta && meta.dpi) || 0,
  })
  if (list.length > HISTORY_LIMIT) list = list.slice(0, HISTORY_LIMIT)
  wx.setStorageSync(KEYS.history, list)
  // 累计张数单独计数：列表截断后仍要能给出真实总量
  wx.setStorageSync(KEYS.historyTotal, (wx.getStorageSync(KEYS.historyTotal) || 0) + 1)
  // 两个字段一次推送（一次 update 提交两个字段），省一次请求
  sync.afterWrite(['history', 'historyTotal'])
  return list
}

function clearHistory() {
  wx.removeStorageSync(KEYS.history)
  wx.removeStorageSync(KEYS.historyTotal)
  // 清空是「删除」语义，必须把空值推上云，否则下次拉取会把已删的历史又带回来
  sync.afterWrite(['history', 'historyTotal'])
}

// ---------- 批量导出（v1.5）----------
// 记录口径（用户已确认）：一次批量任务 = 最近生成里**一条**批量记录 + 打印历史里
// **一条**批量记录，不是 N 条——否则「最近生成」会被一套纸刷屏。
// 批量条目形态：{ batch:true, items:[params...], count, time }（历史条目另有 id）。
// items 保留**整套参数（含失败项）**——最近记录点「再来一套」要能还原整套；
// count 在两个列表里语义不同：最近记录 = 整套张数，历史 = 成功生成的张数（计入累计）。

// 批量任务完成（含部分完成）后记入最近生成；同套去重（签名含顺序，换序即另一套）
function pushBatchRecent(items) {
  if (!items || !items.length) return
  const norm = items.map((p) => papers.normalizeParams(p))
  const sig = papers.batchSignature(norm)
  let list = getRecent()
  list = list.filter((r) => !(r.batch && papers.batchSignature(r.items) === sig))
  list.unshift({ batch: true, items: norm, count: norm.length, time: Date.now() })
  if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT)
  wx.setStorageSync(KEYS.recent, list)
  sync.afterWrite('recent')
}

// 批量任务计入打印历史：一条记录，count = 成功生成的张数；返回记录 id（重试追加用）
function pushBatchHistory(items, okCount) {
  if (!items || !items.length || okCount < 1) return null
  const norm = items.map((p) => papers.normalizeParams(p))
  const id = `b_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  let list = getHistory()
  list.unshift({ batch: true, id, items: norm, count: okCount, time: Date.now(), dpi: 0 })
  if (list.length > HISTORY_LIMIT) list = list.slice(0, HISTORY_LIMIT)
  wx.setStorageSync(KEYS.history, list)
  // 累计张数按成功张数计（一套 N 张成功 k 张就是 +k）
  wx.setStorageSync(KEYS.historyTotal, (wx.getStorageSync(KEYS.historyTotal) || 0) + okCount)
  sync.afterWrite(['history', 'historyTotal'])
  return id
}

// 「重试失败的 k 张」成功后追加张数：**更新同一条**批量历史记录，不新记一条。
// 否则一次批量任务会在历史里留下两条，「一套」的口径就破了。
function bumpBatchHistory(id, add) {
  if (!id || add < 1) return
  const list = getHistory()
  const idx = list.findIndex((h) => h.id === id && h.batch)
  if (idx < 0) return
  list[idx] = { ...list[idx], count: (list[idx].count || 0) + add }
  wx.setStorageSync(KEYS.history, list)
  wx.setStorageSync(KEYS.historyTotal, (wx.getStorageSync(KEYS.historyTotal) || 0) + add)
  sync.afterWrite(['history', 'historyTotal'])
}

// 统计：累计张数（真实值，不受列表截断影响）+ 纸型分布（降序）+ 时间范围
//
// 口径（v1.1 多区块）：**按页计，不按区块计**。一页四宫格不等于印了 4 张，
// 若把每个区块的纸型各记一次，「常用纸型」会被多区块页系统性刷高。
// 故单区块页按其纸型计数，多区块页统一归入「多区块版面」一档——
// 同时也让「多区块被用得多不多」变得可直接观测。
function getHistoryStats() {
  const list = getHistory()
  const map = {}
  list.forEach((h) => {
    // v1.5 批量记录：归入「批量一套」档，按成功张数计（与累计张数口径一致）
    if (h.batch) {
      map[BATCH_KEY] = (map[BATCH_KEY] || 0) + (h.count || 1)
      return
    }
    const key = h.layout === '1x1' ? h.params.blocks[0].type : MULTI_KEY
    map[key] = (map[key] || 0) + 1
  })
  const byType = Object.keys(map)
    .map((k) => ({
      type: k,
      name: k === MULTI_KEY ? '多区块版面' : (k === BATCH_KEY ? '批量一套' : (papers.PAPERS[k] ? papers.PAPERS[k].name : k)),
      count: map[k],
    }))
    .sort((a, b) => b.count - a.count)
  return {
    total: wx.getStorageSync(KEYS.historyTotal) || 0,
    kept: list.length,
    byType,
    firstTime: list.length ? list[list.length - 1].time : 0,
    lastTime: list.length ? list[0].time : 0,
  }
}

module.exports = {
  KEYS,
  getTemplates, saveTemplate, updateTemplate, deleteTemplate, findTemplate,
  buildTemplateName, describeTemplate, syncTemplateNames, TEMPLATE_LIMIT,
  getFavs, isFav, toggleFav,
  getRecent, pushRecent, RECENT_LIMIT,
  getHistory, pushHistory, clearHistory, getHistoryStats, HISTORY_LIMIT,
  pushBatchRecent, pushBatchHistory, bumpBatchHistory,
}
