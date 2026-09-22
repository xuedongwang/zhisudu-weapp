// utils/sync.js
// 用户数据云端同步（v1.2.0 新增）：模板 / 收藏 / 最近生成 / 打印历史 / 累计张数。
//
// 与 v1.1.2 的用户资料同步（utils/cloud.js）是两条独立链路，但遵循同一套原则：
//   **本机是主存储，云端是副本**——云不可用、权限错、超时，一律静默降级为本机读写，
//   绝不让同步失败影响用户当下的操作（点收藏、存模板、导出都必须即时生效）。
//
// ---------------------------------------------------------------------------
// 为什么用**独立集合 userdata**，而不是塞进 users 集合：
//   users 集合的删除走 `where({_openid}).remove()`（见 cloud.clearProfile），是「按 openid
//   删掉本人全部记录」。若把模板/历史也放进去，「清除我的资料」会连带清空用户的模板与
//   历史——而功能文案明确承诺「模板、收藏与打印历史不受影响」。集合分开是唯一能让
//   两句话同时为真的办法。
//
// ---------------------------------------------------------------------------
// 同步方向（这是本模块最需要说清楚的一件事）：
//   · 首次（本机 meta.initialized 为假）：**并集合并，两侧都不丢**，然后整体回推云端。
//     不能简单地「云端覆盖本机」，否则老用户本机攒了半年的模板会在第一次同步时被
//     云端的空文档洗掉；也不能「本机覆盖云端」，否则换新手机的人会把云端旧数据覆盖成空。
//   · 之后：逐字段定方向——
//       本机该字段有未推送成功的改动（pending）→ 本机优先，重新推上去；
//       否则 → 云端覆盖本机（这是常态：换设备、重装后靠它把数据拉回来）。
//
// ---------------------------------------------------------------------------
// 三条硬约束（都是「踩过就会留下静默脏数据」的那类）：
//   ① **查询失败 ≠ 没有记录**。云端的读取异常（集合不存在、权限错、无网）必须与
//      「确认无记录」严格区分：前者绝不能走 add，否则会造出第二条文档，用户在同一
//      账号下看到两份数据，且两份都「看起来正常」。这与 cloud.js 里 fetchCloudDoc
//      返回 { ok, doc } 是同一个教训。
//   ② **容量守卫**：客户端单次 add/update 写入上限 512KB（超出直接失败）。本模块按
//      字段级 update 提交，单字段实测远低于此值（见下方估算），仍保留守卫并在超限时
//      跳过该次推送、保留 pending，而不是把异常抛给调用方。
//      实测估算：模板 20 + 历史 50 + 最近 10 条，每条 params 约 200~400 字节 JSON，
//      全量合计约 30~40KB，距上限有 10 倍余量。
//   ③ **清空要推空值**：clearHistory 用的是 removeStorageSync，读取会得到空字符串。
//      若直接把它推上云，云端会变成 undefined，下次拉取时「删了又回来」。
//      故 schema.js 为每个字段定义了 empty（数组→[]、数字→0）。
// ---------------------------------------------------------------------------

const { KEYS, LIMITS, SYNC_FIELDS, SYNC_FIELD_NAMES } = require('./schema')
const papers = require('./papers')
const cloud = require('./cloud')

const META_KEY = KEYS.meta
const COLLECTION = 'userdata'

// 客户端单次写入硬上限 512KB，留出余量
const MAX_PUSH_BYTES = 400 * 1024

// 热启动重试节流：距上次同步成功不足 5 分钟就不再跑一轮（冷启动必然首次执行）
const RETRY_INTERVAL_MS = 5 * 60 * 1000

// ---------- 同步元信息（本机） ----------

function readMeta() {
  try {
    return wx.getStorageSync(META_KEY) || {}
  } catch (e) {
    return {}
  }
}

function writeMeta(patch) {
  const next = { ...readMeta(), ...patch }
  try {
    wx.setStorageSync(META_KEY, next)
  } catch (e) {
    console.warn('[sync] 同步元信息写入失败', e)
  }
  return next
}

function markPending(field) {
  const pending = { ...(readMeta().pending || {}) }
  pending[field] = true
  writeMeta({ pending })
}

function clearPending(field) {
  const pending = { ...(readMeta().pending || {}) }
  delete pending[field]
  writeMeta({ pending })
}

// ---------- 本机字段读写 ----------
// 刻意**不 require store.js**：store 的写路径要调本模块（写本机 → 推云），
// 双向 require 会成环。这里按 schema 直接读写 storage，绕开 store 的归一化层
// （归一化只服务于读取兼容，落盘结构本身就是规范结构）。

function localValue(field) {
  const f = SYNC_FIELDS[field]
  try {
    const v = wx.getStorageSync(f.key)
    if (v === '' || v === undefined || v === null) return f.empty
    return v
  } catch (e) {
    return f.empty
  }
}

function writeLocal(field, value) {
  const f = SYNC_FIELDS[field]
  try {
    wx.setStorageSync(f.key, value)
  } catch (e) {
    console.warn('[sync] 本机数据写入失败', field, e)
  }
}

/**
 * 净化取值。
 * 收藏里可能残留早期版本的纸型 key（纸型改名或下线）。原先只在页面展示层 filter，
 * 存储里永远留着；一旦上了云，脏 key 会**扩散到用户的每一台设备**。故在「写入本机」
 * 与「推送云端」两处都过滤一遍，从源头掐断。
 */
function sanitize(field, value) {
  if (field === 'favs') {
    const list = Array.isArray(value) ? value : []
    return list.filter((k) => papers.PAPERS[k])
  }
  if (field === 'historyTotal') {
    const n = Number(value)
    return isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  return Array.isArray(value) ? value : SYNC_FIELDS[field].empty
}

// ---------- 合并（仅首次） ----------

/**
 * 首次同步的并集合并。
 * 累计张数取 **max 而非 sum**：首次同步时本机那份计数很可能就是云端那份的历史
 * （同一账号的同一批导出），相加会虚高；取 max 只会低估、不会虚报，且不会清零。
 */
function mergeFirst(field, localVal, cloudVal) {
  const l = sanitize(field, localVal)
  const c = sanitize(field, cloudVal)

  if (field === 'historyTotal') return Math.max(Number(l) || 0, Number(c) || 0)

  const la = Array.isArray(l) ? l : []
  const ca = Array.isArray(c) ? c : []

  if (field === 'favs') {
    // 并集，本机顺序优先（最近收藏在最前）
    const seen = {}
    const out = []
    la.concat(ca).forEach((k) => {
      if (!seen[k]) {
        seen[k] = 1
        out.push(k)
      }
    })
    return out
  }

  // 模板 / 最近 / 历史：按业务键去重 → 按时间降序 → 截断到上限
  //   模板与最近用「整套参数签名」去重（同配置视为同一条）
  //   历史是流水，每次导出各一条，用 id 去重（老数据无 id 时退化为「签名+时间」）
  const keyOf = field === 'history'
    ? (e) => e.id || `${papers.signature(e.params)}|${e.time}`
    : (e) => papers.signature(e.params)
  const timeOf = field === 'templates' ? (e) => e.createdAt || 0 : (e) => e.time || 0

  const seen = {}
  const out = []
  la.concat(ca).forEach((raw) => {
    const e = papers.normalizeEntry(raw)
    const k = keyOf(e)
    if (seen[k]) return
    seen[k] = 1
    out.push(e)
  })
  // 本机条目先入 out；JS 的 sort 是稳定的，时间相同的场景下本机排在前面
  out.sort((a, b) => timeOf(b) - timeOf(a))
  return out.slice(0, LIMITS[field])
}

// ---------- 云端读写 ----------

function db() {
  return wx.cloud.database()
}

/** 粗估一次写入的字节量。JSON 里的中文按 UTF-8 是 3 字节，乘 2 是折中偏保守的估算 */
function estimateBytes(obj) {
  try {
    return JSON.stringify(obj).length * 2
  } catch (e) {
    return Infinity
  }
}

/**
 * 找到本人的云端文档 id。
 * 返回三态——string（找到）/ null（**确认**没有记录）/ undefined（**查询本身失败**）。
 * undefined 与 null 被调用方严格区分：前者绝不允许 add。
 */
async function ensureDoc(openid) {
  const cached = readMeta().docId
  if (cached) return cached
  try {
    const res = await db().collection(COLLECTION).where({ _openid: openid }).limit(1).get()
    const doc = res && res.data && res.data[0]
    if (doc) {
      writeMeta({ docId: doc._id })
      return doc._id
    }
    return null
  } catch (e) {
    console.warn('[sync] 云端数据读取失败（请检查 userdata 集合是否创建、权限是否为「仅创建者可读写」）', e)
    return undefined
  }
}

/** 文档被删（比如在云开发控制台手工清过）时本地缓存的 docId 会失效，需要识别出来 */
function isMissingDocError(e) {
  const msg = (e && (e.errMsg || e.message)) || ''
  return /not\s*exist|not\s*found|no\s*such|-502004/i.test(msg)
}

/**
 * 把若干字段推上云。字段级 update：一次提交只影响列出的字段，
 * 因此「改收藏」不会覆盖历史，「存模板」不会动最近记录——字段之间天然互不干扰，
 * 多设备各自改各自的字段时几乎不会互相踩。
 */
async function pushFields(fields) {
  if (!fields.length) return { ok: true }
  if (!cloud.cloudReady()) return { ok: false, reason: 'cloud_unavailable' }

  const openid = await cloud.getOpenid()
  if (!openid) return { ok: false, reason: 'no_openid' }

  const data = {}
  fields.forEach((f) => {
    data[f] = localValue(f)
  })

  const bytes = estimateBytes(data)
  if (bytes > MAX_PUSH_BYTES) {
    // 保留 pending，用户删掉一些模板/历史后下次同步会自然补上
    console.warn(`[sync] 待同步数据约 ${Math.round(bytes / 1024)}KB，超过单次写入上限，本次跳过`)
    return { ok: false, reason: 'too_large' }
  }

  const docId = await ensureDoc(openid)
  if (docId === undefined) return { ok: false, reason: 'cloud_query_failed' }

  const commit = async (id) => {
    if (id) {
      await db().collection(COLLECTION).doc(id).update({ data })
      return id
    }
    const res = await db().collection(COLLECTION).add({ data: { ...data, createdAt: Date.now() } })
    const newId = res && res._id
    if (newId) writeMeta({ docId: newId })
    return newId
  }

  try {
    await commit(docId)
    fields.forEach(clearPending)
    return { ok: true }
  } catch (e) {
    // 缓存的 docId 已失效 → 清掉重来一次，否则会永久卡在同一个 id 上
    if (docId && isMissingDocError(e)) {
      writeMeta({ docId: '' })
      try {
        await commit(null)
        fields.forEach(clearPending)
        return { ok: true }
      } catch (e2) {
        console.warn('[sync] 云端写入失败（文档重建后仍失败）', fields, e2)
        return { ok: false, reason: 'write_failed' }
      }
    }
    console.warn('[sync] 云端写入失败', fields, e)
    return { ok: false, reason: 'write_failed' }
  }
}

// ---------- 写后触发（供 store.js 调用） ----------

// 全局串行链：连续快速操作（连点收藏、连续导出）会触发多次推送，串行执行可保证
// 「最后一次的值最后到达云端」，避免乱序把新值覆盖成旧值。频率是用户点击级，代价可忽略。
let chain = Promise.resolve()

function queue(task) {
  chain = chain.then(task).catch(() => {})
  return chain
}

/**
 * 本机写完（一个或多个）字段后调用：标记待推送 + 异步推云。
 * 不返回云端结果——写本机已经成功了，同步失败与否都不能影响用户当下的操作。
 * @param {string|string[]} field
 */
function afterWrite(field) {
  const fields = Array.isArray(field) ? field : [field]
  fields.forEach((f) => {
    const raw = localValue(f)
    const clean = sanitize(f, raw)
    // 顺手把本机的脏收藏 key 写回存储（原先只在展示层 filter，存储里永远留着）
    if (Array.isArray(clean) && Array.isArray(raw) && clean.length !== raw.length) {
      writeLocal(f, clean)
    }
    markPending(f)
  })
  return queue(() => pushFields(fields))
}

// ---------- 启动同步 ----------

let running = null   // 在途同步的 Promise（null = 当前没有同步在跑）
let lastOk = false
const waiters = []

/**
 * 同步完成后通知页面重读数据——跨设备拉回来的模板/收藏/历史必须**立刻**可见，
 * 否则用户要退出页面重进才看得到。
 *
 * ⚠️ 没有在途同步时**不回调**：那种情况下本机数据已经是同步后的结果，
 * 页面 onShow 里读到的就是最新的，再刷一次纯属浪费（还会重复生成缩略图）。
 *
 * 返回取消函数：页面 onHide/onUnload 时调用，避免回调落在已卸载的页面上。
 */
function onSynced(cb) {
  if (!running) return () => {}
  waiters.push(cb)
  return () => {
    const i = waiters.indexOf(cb)
    if (i > -1) waiters.splice(i, 1)
  }
}

function finish(ok) {
  lastOk = !!ok
  const list = waiters.splice(0)
  list.forEach((cb) => {
    try {
      cb(lastOk)
    } catch (e) {
      console.warn('[sync] 同步回调异常', e)
    }
  })
}

async function run() {
  if (!cloud.cloudReady()) {
    finish(false)
    return { ok: false, reason: 'cloud_unavailable' }
  }

  const openid = await cloud.getOpenid()
  if (!openid) {
    writeMeta({ lastSyncOk: false })
    finish(false)
    return { ok: false, reason: 'no_openid' }
  }

  let res = null
  try {
    res = await db().collection(COLLECTION).where({ _openid: openid }).limit(1).get()
  } catch (e) {
    console.warn('[sync] 云端数据读取失败（请检查 userdata 集合是否创建、权限是否为「仅创建者可读写」）', e)
    writeMeta({ lastSyncOk: false })
    finish(false)
    return { ok: false, reason: 'cloud_query_failed' }
  }

  const doc = (res && res.data && res.data[0]) || null
  const meta = readMeta()
  const pending = meta.pending || {}

  // ---- 情形一：云端还没有本人的文档 ----
  if (!doc) {
    const hasLocal = SYNC_FIELD_NAMES.some((f) => {
      const v = localValue(f)
      return Array.isArray(v) ? v.length > 0 : Number(v) > 0
    })
    // docId 先清空（缓存的 docId 可能指向已被删除的文档）
    writeMeta({ docId: '' })
    if (hasLocal) {
      const r = await pushFields(SYNC_FIELD_NAMES)
      // ⚠️ initialized **只在推送成功时**才置位（2026-09-22 修）。
      // 若失败也置位：本次无碍（云端仍无文档，下次还走情形一重试），但一旦云端此后
      // 出现了本人文档（另一台设备推的），本机会误判为「已完成首次同步」而走情形三，
      // 即「云端覆盖本机」——把本机独有的模板/历史覆盖掉，且不可逆。
      // 失败时不置位，下次就能正常走情形二（并集合并），两侧都不丢。
      if (r.ok) writeMeta({ initialized: true })
      writeMeta({ lastSyncAt: Date.now(), lastSyncOk: !!r.ok })
      finish(!!r.ok)
      return { ok: !!r.ok, first: true, uploaded: true, reason: r.reason }
    }
    // 本机也是空的（新用户）：不建空文档，省一条记录。
    // 本机没有任何数据需要保护，可直接置位 initialized。
    writeMeta({ initialized: true, lastSyncAt: Date.now(), lastSyncOk: true })
    finish(true)
    return { ok: true, first: true, uploaded: false }
  }

  writeMeta({ docId: doc._id })

  // ---- 情形二：本机首次遇到云端已有数据 → 并集合并 ----
  if (!meta.initialized) {
    SYNC_FIELD_NAMES.forEach((f) => {
      writeLocal(f, mergeFirst(f, localValue(f), doc[f]))
    })
    writeMeta({ initialized: true })
    const r = await pushFields(SYNC_FIELD_NAMES)
    writeMeta({ lastSyncAt: Date.now(), lastSyncOk: !!r.ok })
    finish(!!r.ok)
    return { ok: !!r.ok, first: true, merged: true, reason: r.reason }
  }

  // ---- 情形三：常态化。逐字段定方向 ----
  const needPush = []
  SYNC_FIELD_NAMES.forEach((f) => {
    if (pending[f]) {
      needPush.push(f)   // 本机有未推送成功的改动 → 本机优先，不能被云端覆盖
      return
    }
    // 云端没有这个字段（老文档，或以后新增字段）→ 保留本机，别用空值把它抹掉
    if (doc[f] === undefined || doc[f] === null) return
    writeLocal(f, sanitize(f, doc[f]))
  })

  let ok = true
  if (needPush.length) {
    const r = await pushFields(needPush)
    ok = !!r.ok
  }
  writeMeta({ lastSyncAt: Date.now(), lastSyncOk: ok })
  finish(ok)
  return { ok, pulled: true, pushed: needPush }
}

/**
 * 启动同步。冷启动调一次；热启动会走节流（上次成功不足 5 分钟则跳过）。
 * 全程异步、静默——绝不影响启动与首屏。
 * 重复调用（app.onLaunch + 页面）会复用同一轮在途同步，不会并发打网络。
 */
function bootstrap() {
  if (running) return running

  const meta = readMeta()
  if (
    meta.lastSyncOk &&
    meta.lastSyncAt &&
    Date.now() - meta.lastSyncAt < RETRY_INTERVAL_MS
  ) {
    // 节流跳过：不置 running，因此此刻注册的 onSynced 不会被回调（数据确实没变）
    return Promise.resolve({ ok: true, skipped: true })
  }

  running = run()
    .catch((e) => {
      console.warn('[sync] 同步异常', e)
      finish(false)
      return { ok: false, reason: 'exception' }
    })
    .then((r) => {
      // 必须等 run() 内部的 finish() 通知完再清 running，否则临门一脚注册的页面会漏刷
      running = null
      return r
    })
  return running
}

/** 供「我的」页显示同步状态（与资料同步状态取与，见 pages/mine） */
function syncState() {
  const m = readMeta()
  return {
    ok: !!m.lastSyncOk,
    lastSyncAt: m.lastSyncAt || 0,
    pending: Object.keys(m.pending || {}),
  }
}

module.exports = {
  bootstrap, afterWrite, onSynced, syncState,
  COLLECTION, META_KEY,
}
