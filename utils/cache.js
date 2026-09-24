// utils/cache.js
// USER_DATA_PATH 本地文件清理（v1.1.1 新增）。
//
// 为什么必须有这个模块：本地用户文件与本地缓存文件**合计上限 200MB**，
// 且官方明确「超过 200M 后继续存储文件会失败，平台不会自动清理」。
// 而本项目在 USER_DATA_PATH 下按时间戳写文件、只增不减：
//   paper_<ts>.png    每次导出新建一个   → 长尾使用后写满，导出直接失败
//   thumb_v<N>_*.png  每次生成一个       → 版本号 +1 后旧文件全部残留
//   avatar_<ts>.png   换头像时已主动删旧 → 仍需兜底（异常退出会留残file）
//
// 安全原则（重要）：**白名单删除**——只删本文件显式列出的三种前缀，
// 且文件名必须完全匹配正则；任何不认识的条目一律跳过。
// 绝不在此模块里做目录级清空。

const thumbs = require('./thumbs')
const { KEYS } = require('./schema')

const EXPORT_PREFIX = 'paper_'
const AVATAR_PREFIX = 'avatar_'
const THUMB_PREFIX = 'thumb_v'

// 保留最近 N 张导出图。为什么不是 1：success 页持有路径用于预览/保存/分享，
// 用户可能返回 config 再导出一次、页面栈里同时存在多个 success 页。
// v1.5 起批量导出一次产生最多 9 张（schema.LIMITS.batch），3 是单张时代的假设——
// N>3 时最早的几张会在下次启动被回收，用户没存完相册回来路径就失效了。
// 12 = 一批 9 张 + 3 张单导余量（单张几十 KB~几百 KB，磁盘可控）。
const KEEP_EXPORTS = 12

const RE_EXPORT = /^paper_(\d+)\.png$/
const RE_AVATAR = /^avatar_(\d+)\.png$/
const RE_THUMB = /^thumb_v(\d+)_.*\.png$/

function fsm() {
  return wx.getFileSystemManager()
}

function dir() {
  return wx.env.USER_DATA_PATH
}

/** 列出 USER_DATA_PATH 下的文件名（失败给空数组，调用方无需判空） */
function listFiles() {
  return new Promise((resolve) => {
    try {
      fsm().readdir({
        dirPath: dir(),
        success: (res) => resolve(res.files || []),
        fail: () => resolve([]),
      })
    } catch (e) {
      resolve([])
    }
  })
}

/** 删除单文件；失败静默（文件可能已被系统回收或正被占用） */
function removeOne(name) {
  return new Promise((resolve) => {
    try {
      fsm().unlink({ filePath: `${dir()}/${name}`, success: () => resolve(true), fail: () => resolve(false) })
    } catch (e) {
      resolve(false)
    }
  })
}

/**
 * 清理旧版本缩略图：thumb_v<N>_* 中 N ≠ 当前 THUMB_VERSION 的全部删除。
 * 这正是「缩略图缓存键带版本号」机制的配套——不清理则每次升版都多积一批永久残留。
 */
async function sweepThumbs(files) {
  const names = files || (await listFiles())
  const cur = thumbs.THUMB_VERSION
  const targets = names.filter((n) => {
    const m = RE_THUMB.exec(n)
    return m && Number(m[1]) !== cur
  })
  const results = await Promise.all(targets.map(removeOne))
  return results.filter(Boolean).length
}

/** 清理导出图：按文件名里的时间戳排序，仅保留最新 KEEP_EXPORTS 张 */
async function sweepExports(files) {
  const names = files || (await listFiles())
  const items = []
  names.forEach((n) => {
    const m = RE_EXPORT.exec(n)
    if (m) items.push({ name: n, ts: Number(m[1]) })
  })
  if (items.length <= KEEP_EXPORTS) return 0
  items.sort((a, b) => b.ts - a.ts) // 新 → 旧
  const targets = items.slice(KEEP_EXPORTS).map((i) => i.name)
  const results = await Promise.all(targets.map(removeOne))
  return results.filter(Boolean).length
}

/**
 * 清理孤儿头像：保留「当前资料里记录的那一张」，其余全删。
 * 正常路径下 cloud.js 换头像时已主动删旧文件，这里只兜底异常场景。
 *
 * v1.1.2 起头像会迁移到云存储（profile.avatar 变成 `cloud://…` fileID），
 * 此时**本地不存在被引用的头像文件**，残留的 avatar_*.png 全是孤儿，可全部回收。
 *
 * 注意：解析不出当前头像（profile 为空）时**什么都不删**——
 * 宁可留垃圾，不可删错在用文件。
 */
async function sweepAvatars(files) {
  const names = files || (await listFiles())
  const current = (wx.getStorageSync(KEYS.profile) || {}).avatar || ''
  if (!current) return 0
  const isLocal = current.indexOf(wx.env.USER_DATA_PATH) === 0
  const curName = current.split('/').pop()
  const targets = names.filter((n) => {
    if (!RE_AVATAR.test(n)) return false
    if (!isLocal) return true        // 头像在云端或为临时路径 → 本地这些都不再被引用
    return n !== curName
  })
  const results = await Promise.all(targets.map(removeOne))
  return results.filter(Boolean).length
}

/**
 * 清空本机**全部**自有头像文件（`avatar_<时间戳>.png`）。
 *
 * 与 sweepAvatars 的区别（方向正好相反，别混用）：
 * sweepAvatars 是运行期的**保守**回收——解析不出当前头像（profile 为空）时宁可留垃圾
 * 也不删，怕删错在用的文件；本函数只由「清除我的资料」这一个明确意图的入口调用，
 * 此刻资料已被清空、本机不可能还有「在用」的头像，所以要求**清干净**。
 *
 * 为什么非有它不可：头像在 v1.1.2 之后会迁到云存储，profile 里只剩 `cloud://…` fileID，
 * 本机那张 png 的路径无从定位（cloud.js 的 removeLocalAvatar 够不着）；而 profile 被清空后
 * sweepAvatars 又会保守地零删除——两边都够不着，用户点了「清除我的资料」却在本机留下一张
 * 头像图，属于删除不彻底。
 *
 * 安全边界不变：仍然只删完全匹配 RE_AVATAR 的自有文件，不认识的条目一律跳过。
 */
async function purgeAvatars(files) {
  const names = files || (await listFiles())
  const targets = names.filter((n) => RE_AVATAR.test(n))
  const results = await Promise.all(targets.map(removeOne))
  return results.filter(Boolean).length
}

/**
 * 全量清扫（启动时调一次，异步、静默、不阻塞启动）
 * 返回 {thumbs, exports, avatars}，仅用于日志与自测断言
 */
async function sweepAll() {
  const files = await listFiles()
  const [thumbs, exports, avatars] = await Promise.all([
    sweepThumbs(files),
    sweepExports(files),
    sweepAvatars(files),
  ])
  const removed = thumbs + exports + avatars
  if (removed) console.log('[cache] 清理本地文件', { thumbs, exports, avatars })
  return { thumbs, exports, avatars }
}

module.exports = {
  sweepAll, sweepThumbs, sweepExports, sweepAvatars, purgeAvatars, listFiles,
  KEEP_EXPORTS,
}
