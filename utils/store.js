// utils/store.js
// 本地存储：自定义模板 / 纸型收藏 / 最近生成记录（PRD FR-09/10/11）
// 全部使用 wx.setStorageSync 本地存储，无后端。

const KEYS = {
  templates: 'zsda_templates', // 模板上限 20（PRD FR-09.1）
  favs: 'zsda_favs',           // 收藏的纸型 key 列表
  recent: 'zsda_recent',       // 最近生成记录上限 10（PRD FR-10.1）
}

const TEMPLATE_LIMIT = 20
const RECENT_LIMIT = 10

// ---------- 自定义模板 ----------
function getTemplates() {
  return wx.getStorageSync(KEYS.templates) || []
}

// 保存模板；返回 {ok, message}
function saveTemplate(type, params) {
  const list = getTemplates()
  if (list.length >= TEMPLATE_LIMIT) {
    return { ok: false, message: `模板已满（${TEMPLATE_LIMIT} 个），请删除后再保存` }
  }
  const papers = require('./papers')
  const p = papers.PAPERS[type]
  const tpl = {
    id: `t_${Date.now()}`,
    type,
    name: `${p.name} · ${p.cell.label}${params.cell}mm`,
    params: { ...params },
    createdAt: Date.now(),
  }
  list.unshift(tpl)
  wx.setStorageSync(KEYS.templates, list)
  return { ok: true, message: '已存为模板' }
}

function deleteTemplate(id) {
  const list = getTemplates().filter((t) => t.id !== id)
  wx.setStorageSync(KEYS.templates, list)
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
  return list
}

// ---------- 最近生成记录 ----------
function getRecent() {
  return wx.getStorageSync(KEYS.recent) || []
}

function pushRecent(type, params) {
  let list = getRecent()
  // 同配置去重：相同纸型 + 相同参数的旧记录移除，新记录置顶
  const sig = JSON.stringify(params)
  list = list.filter((r) => !(r.type === type && JSON.stringify(r.params) === sig))
  list.unshift({ type, params: { ...params }, time: Date.now() })
  if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT)
  wx.setStorageSync(KEYS.recent, list)
}

module.exports = {
  getTemplates, saveTemplate, deleteTemplate, findTemplate, TEMPLATE_LIMIT,
  getFavs, isFav, toggleFav,
  getRecent, pushRecent, RECENT_LIMIT,
}
