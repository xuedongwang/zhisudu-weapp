// utils/track.js
// 埋点统一入口（PRD 第十章「数据与埋点需求」）。
//
// 四条硬约定：
// 1) 只上报 EVENTS 白名单内的事件与字段，未登记的事件/字段直接丢弃——防止脏数据污染后台口径；
// 2) 任何异常静默吞掉并 console.warn，埋点绝不允许影响主流程（导出、保存等）；
// 3) 文本字段统一截断至 64 字符；数值字段保持 Number 并取整
//    （We分析事件仅支持「字符 / 整数」属性，浮点属性会被隐藏）；
// 4) 单通道 wx.reportEvent：wx.reportAnalytics 自基础库 2.31.1 起已停止维护（官方要求改用
//    reportEvent），故不做旧接口回退——回退分支在现实中永远不会命中，只会掩盖问题。
//
// ⚠️ 前置依赖：wx.reportEvent 的上报数据需先在 mp 后台建事件才会入库。
// 入口：We分析 → 数据管理 → 事件管理 → 新建事件（旧入口「设置 → 开发设置 → 自定义分析」已迁移）。
// 事件英文名、属性名与类型须与本文件 EVENTS / NUMERIC_FIELDS 逐字对齐；
// 事件管理页会直接生成一段上报代码，可用来核对事件名拼写。

const MAX_TEXT_LEN = 64

// 事件 → 允许上报的字段（与 PRD 第十章表格逐行对应）
const EVENTS = {
  page_view: ['page_name'],
  paper_select: ['paper_type', 'source'],
  param_change: ['param_key', 'paper_type'],
  export_click: ['paper_type', 'action'],
  export_success: ['paper_type', 'dpi', 'duration_ms'],
  export_fail: ['paper_type', 'fail_reason'],
  // source：'template' 表示在模板入口就地覆盖（更新），缺省表示新增一条
  template_save: ['paper_type', 'source'],
  template_reuse: ['paper_type'],
  // 转发卡片：onShareAppMessage 被触发时上报。
  // 注意口径——微信不提供分享成功回调，故此事件只表示「用户触发了转发」，不代表消息真的发出去了。
  // 复用 page_name（home/config/success）标识分享发生的页面，不新增属性。
  share_click: ['page_name', 'paper_type'],
}

// 数值型字段：后台须建为「整数」属性，其余按文本上报
const NUMERIC_FIELDS = ['dpi', 'duration_ms']

// ---------- 上报通道可用性 ----------
// wx.reportEvent 自基础库 2.14.4 起支持（API 文档口径）。We分析 FAQ 另有「2.14.1 已上线新接口」
// 的说法，两处不一致，此处取更严的下限——低版本调用无效果，不报错。
const MIN_SDK_VERSION = '2.14.4'

let channelChecked = null // null=未探测 / true / false

function compareVersion(v1, v2) {
  const a = String(v1).split('.')
  const b = String(v2).split('.')
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const n1 = parseInt(a[i] || '0', 10) || 0
    const n2 = parseInt(b[i] || '0', 10) || 0
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

// 只探测一次：基础库过低时后续上报全部短路，避免反复刷 warn
function channelAvailable() {
  if (channelChecked !== null) return channelChecked

  if (typeof wx.reportEvent !== 'function') {
    channelChecked = false
    console.warn(`[track] 当前基础库不支持 wx.reportEvent（需 ≥ ${MIN_SDK_VERSION}），埋点已整体跳过`)
    return channelChecked
  }

  try {
    // getAppBaseInfo 需 2.20.1+，低版本退回 getSystemInfoSync
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()
    const sdk = info && info.SDKVersion
    channelChecked = !sdk || compareVersion(sdk, MIN_SDK_VERSION) >= 0
  } catch (e) {
    channelChecked = true // 版本号取不到时不阻塞上报
  }

  if (!channelChecked) {
    console.warn(`[track] 基础库版本低于 ${MIN_SDK_VERSION}，埋点已整体跳过`)
  }
  return channelChecked
}

function buildPayload(event, data) {
  const fields = EVENTS[event]
  const payload = {}
  fields.forEach((key) => {
    const raw = data ? data[key] : undefined
    if (raw === undefined || raw === null) return
    if (NUMERIC_FIELDS.indexOf(key) > -1) {
      const num = Number(raw)
      // We分析只支持整数属性，浮点会被静默隐藏，故统一取整
      if (!isNaN(num)) payload[key] = Math.round(num)
      return
    }
    const text = String(raw).slice(0, MAX_TEXT_LEN)
    if (text !== '') payload[key] = text
  })
  return payload
}

// ---------- 非正式环境回显 ----------
// reportEvent 无 success/fail 回调，前端拿不到上报结果，所以自查只能靠日志 + 后台「事件管理 → 测试」。
// 正式版（release）完全静默；开发版/体验版把每次上报回显到控制台，便于一眼确认打点是否触发、payload 是否正确。
let debugEnabled = null

function isDebug() {
  if (debugEnabled !== null) return debugEnabled
  try {
    const info = wx.getAccountInfoSync()
    const env = info && info.miniProgram && info.miniProgram.envVersion
    debugEnabled = env !== 'release'
  } catch (e) {
    debugEnabled = true // 取不到环境信息时按调试处理（只影响日志，不影响上报）
  }
  return debugEnabled
}

/**
 * 上报一个埋点事件
 * @param {string} event 事件名，须在 EVENTS 内
 * @param {object} data  字段键值对，超出白名单的字段会被丢弃
 */
function report(event, data) {
  if (!EVENTS[event]) {
    console.warn('[track] 未登记的事件，已丢弃：', event)
    return
  }
  if (!channelAvailable()) return

  const payload = buildPayload(event, data)
  try {
    wx.reportEvent(event, payload)
    if (isDebug()) console.log('[track]', event, payload)
  } catch (e) {
    // 埋点失败不影响业务，仅开发期提示
    console.warn('[track] 上报失败（已忽略）：', event, e)
  }
}

// ---------- param_change 去重 ----------
// 口径：param_change 记录「用户调整了哪个参数」，不统计次数。
// 滑块/输入框连续触发会产生大量重复事件，故同一页面实例内同一参数只上报一次。
// v1.1：多区块下一个页面可能有多个同纸型区块，故去重键加入区块下标（slot），
//       否则「区块2 调格宽」会被「区块1 调格宽」的去重吃掉、漏报。
let paramDedup = {}

function reportParamChange(paperType, key, slot) {
  const sig = `${paperType}|${key}|${slot === undefined ? '' : slot}`
  if (paramDedup[sig]) return
  paramDedup[sig] = true
  report('param_change', { paper_type: paperType, param_key: key })
}

// 进入配置页时重置（每次进入配置页可重新记录一轮）
function resetParamDedup() {
  paramDedup = {}
}

// ---------- 各页面便捷封装 ----------
function pageView(pageName) {
  report('page_view', { page_name: pageName })
}

function exportFail(paperType, err) {
  const raw = (err && (err.message || err.errMsg)) || 'unknown'
  // 去掉 errMsg 前缀噪声（如 "saveImageToPhotosAlbum:fail "），只留原因关键词
  const reason = String(raw).replace(/^\w+:\s*fail\s*/i, '').slice(0, MAX_TEXT_LEN)
  report('export_fail', { paper_type: paperType, fail_reason: reason })
}

module.exports = {
  EVENTS,
  report,
  reportParamChange,
  resetParamDedup,
  pageView,
  exportFail,
}
