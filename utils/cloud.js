// utils/cloud.js
// 云开发能力封装：openid 获取 + 用户资料（头像/昵称）云端同步。
//
// 运行前提（三项都要满足，否则静默降级为「仅本机」，功能不坏但换设备丢资料）：
//   ① users 集合已创建，权限为「仅创建者可读写」；
//   ② login 云函数已部署（返回 { openid }）；
//   ③ 云存储权限保持默认（所有用户可读，仅创建者可读写）——头像 fileID 要能被 image 渲染。
//
// ---------------------------------------------------------------------------
// v1.1.2 修复：原实现的「云端同步」实际是断的（排查发现的 P0），四处缺陷一起改：
//   1. 读云端依赖本机 storage 里的 docId（docId 只在本机）→ 换手机 / 清缓存后
//      云端那份资料**永远读不回来**。改为按 _openid 查询：openid 由 login 云函数
//      取一次并缓存（openid 永久不变），此后与 docId 无关。
//   2. 云端 avatar 存的是**本机文件路径**（wxfile://usr/avatar_xxx.png）→ 即便读回来
//      也是废值。改为上传云存储、存 fileID（cloud://…），image 组件可直接渲染。
//   3. 无「先查后写」：docId 丢了就会 add 出重复记录。改为 upsert（先查 _openid 再定增改）。
//   4. 回调不返回真实同步状态，UI 只能拿「云能力是否初始化」当判据（假绿）。
//      改为回调第二个参数 meta，页面据此显示「已同步云端 / 仅本机保存」。
//
// 顺带：头像上云后，本机 avatar_*.png 不再被引用，交由 utils/cache.js 回收（已适配）。
// ---------------------------------------------------------------------------
// v1.1.3 新增：clearProfile() —— 为用户提供「删除我的个人信息」的途径。
//
// 为什么必须做：v1.1.2 之后头像与昵称写入云开发环境（数据库 + 云存储），
// 「数据全在本机、删小程序即清空」这个原先成立的前提失效了。微信《用户隐私保护指引》
// 要求为用户提供删除其个人信息的途径，光在指引里写「删小程序即可」与实际不符。
//
// ⚠️ 本函数最容易犯的错，是把「删除失败」报成「删除成功」——那正是 v1.1.2 修掉的那类
// 「假成功」。删除比写入更不容许假成功：用户以为删干净了，实际云端那条记录还在。
// 因此三条硬约束写死在实现里：
//   ① 云端**先删文件、后删记录**——文件删失败就保留记录，下次重试还能从记录里拿到 fileID；
//      反过来先删记录，fileID 这条线索就没了，云存储上会永久留下一个孤儿头像文件。
//   ② 云端只要没删成（查不到 openid / 查询失败 / 删文件失败 / 删记录失败），
//      **本机也不清**。否则下次 loadProfile 会把云端那份资料读回来，表现为「删了又回来」，
//      比直接报错更糟，且合规上等于没删。
//   ③ 唯一的例外是「云能力未初始化」（cloudReady=false）：此时 saveProfile 的云端写入分支
//      根本走不到，可安全判定「本机从未写入过云端」，直接清本机即可。
// ---------------------------------------------------------------------------

const { KEYS } = require('./schema')

const PROFILE_KEY = KEYS.profile     // 本地缓存：{ avatar, nickname, openid }
const COLLECTION = 'users'
const CLOUD_PREFIX = 'cloud://'
// 删除时一次取出的记录上限。正常只有 1 条；老实现（无「先查后写」）可能遗留重复记录，
// 删除操作必须把名下的记录都清掉，不能只删第一条。
const MAX_DOCS = 20

function cloudReady() {
  try {
    return !!(wx.cloud && getApp() && getApp().globalData.cloudReady)
  } catch (e) {
    return false
  }
}

function db() {
  return wx.cloud.database()
}

function readLocal() {
  try {
    return wx.getStorageSync(PROFILE_KEY) || {}
  } catch (e) {
    return {}
  }
}

/** 写本地缓存：显式剔除已废弃的 docId，避免与新的 _openid 查询语义混淆 */
function writeLocal(patch) {
  const next = { ...readLocal(), ...patch }
  delete next.docId
  try {
    wx.setStorageSync(PROFILE_KEY, next)
  } catch (e) {
    console.warn('[cloud] 本地资料写入失败', e)
  }
  return next
}

/** 判断是否「需要先落地到本地」的临时路径（chooseAvatar 给的是 http://tmp 或 wxfile://tmp 形式） */
function needsPersist(path) {
  if (!path) return false
  if (path.indexOf(CLOUD_PREFIX) === 0) return false
  if (path.indexOf(wx.env.USER_DATA_PATH) === 0) return false
  return true
}

function fileExists(path) {
  return new Promise((resolve) => {
    if (!path) return resolve(false)
    try {
      wx.getFileSystemManager().access({
        path,
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch (e) {
      resolve(false)
    }
  })
}

/**
 * 规整头像：本机路径要先确认文件还在。
 * 为什么必需：v1.1.1 及以前云端存的是本机路径，换设备后文件不存在，
 * 若不置空就会得到一个「看起来有头像、实际渲染不出」的空壳，
 * 而且会连带把用户资料判为「已填齐」而锁定，让用户想重设都改不了。
 */
async function normalizeAvatar(p) {
  const avatar = (p && p.avatar) || ''
  const nickname = (p && p.nickname) || ''
  if (!avatar || avatar.indexOf(CLOUD_PREFIX) === 0) return { avatar, nickname }
  const ok = await fileExists(avatar)
  return { avatar: ok ? avatar : '', nickname }
}

/** 取 openid：优先本机缓存（openid 永久不变），否则调 login 云函数取一次 */
function getOpenid() {
  const cached = readLocal().openid
  if (cached) return Promise.resolve(cached)
  if (!cloudReady()) return Promise.resolve(null)
  return wx.cloud.callFunction({ name: 'login' })
    .then((res) => {
      const openid = (res && res.result && res.result.openid) || null
      if (openid) writeLocal({ openid })
      else console.warn('[cloud] login 云函数未返回 openid，请确认已部署 cloudfunctions/login')
      return openid
    })
    .catch((e) => {
      console.warn('[cloud] 获取 openid 失败，请确认已部署 login 云函数', e)
      return null
    })
}

/**
 * 查当前用户的云端资料记录（_openid 由云开发自动写入，与 docId 无关）。
 * 返回 { ok, doc }：**ok=false 表示「查询本身失败」（集合不存在 / 权限错 / 网络），
 * 必须与 ok=true,doc=null（确实还没有记录）区分开**——否则调用方会把「查不到」
 * 误解成「没有记录」，进而 add 出一条重复记录（权限配错时就会这样）。
 */
async function fetchCloudDoc(openid) {
  if (!openid) return { ok: false, doc: null }
  try {
    const res = await db().collection(COLLECTION).where({ _openid: openid }).limit(1).get()
    return { ok: true, doc: (res && res.data && res.data[0]) || null }
  } catch (e) {
    console.warn('[cloud] 读取云端资料失败（请检查 users 集合是否创建、权限是否为「仅创建者可读写」）', e)
    return { ok: false, doc: null }
  }
}

/** 头像上传云存储 → 返回 fileID；失败返回原路径（本地兜底，下次进入会自动重试迁移） */
async function uploadAvatar(localPath, prevAvatar) {
  if (!localPath || !cloudReady()) return localPath
  if (localPath.indexOf(CLOUD_PREFIX) === 0) return localPath
  try {
    const m = /\.([a-z0-9]+)$/i.exec(localPath)
    const ext = (m && m[1]) || 'png'
    const cloudPath = `avatar/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: localPath })
    const fileID = res && res.fileID
    if (!fileID) return localPath
    // 换头像时回收云存储上的旧文件，避免云端只增不减（与本地 sweepAvatars 同一思路）
    if (prevAvatar && prevAvatar.indexOf(CLOUD_PREFIX) === 0 && prevAvatar !== fileID) {
      wx.cloud.deleteFile({ fileList: [prevAvatar] }).catch(() => {})
    }
    return fileID
  } catch (e) {
    console.warn('[cloud] 头像上传云存储失败，暂用本机路径', e)
    return localPath
  }
}

/**
 * 读取用户资料：本地优先（快）→ 云端补齐（权威）。
 * cb(profile, meta)，meta = { source: 'local' | 'cloud', synced: boolean }
 * 可能被调用两次；页面以最后一次为准。
 */
function loadProfile(cb) {
  const local = readLocal()

  // 第一轮回调：本地缓存
  normalizeAvatar(local).then((p) => {
    if (p.avatar || p.nickname) cb(p, { source: 'local', synced: false })
  })

  // 第二轮回调：云端
  if (!cloudReady()) return
  getOpenid()
    .then((openid) => {
      if (!openid) return null
      // 注意：openid 必须随查询结果一起往下传——它是下面迁移头像的必需参数，
      // 若只传 doc，migrateAvatar 会抛 ReferenceError 并被末尾的 catch 静默吞掉。
      return fetchCloudDoc(openid).then((r) => ({ openid, ...r }))
    })
    .then((r) => {
      if (!r || !r.ok || !r.doc) return
      const { openid, doc } = r
      return normalizeAvatar(doc).then((p) => {
        writeLocal(p)
        cb(p, { source: 'cloud', synced: true })
        migrateAvatar(p.avatar, openid)   // 静默迁移旧的本机路径头像
      })
    })
    .catch(() => {})
}

/**
 * 把「仍在本机路径」的头像补传云存储（老数据迁移）。
 * 只在读到云端记录后触发；不回调 UI（避免头像来回跳），成功后写回缓存与云端，
 * 下次进入即显示云 fileID。失败无害，下次重试。
 */
async function migrateAvatar(avatar, openid) {
  if (!avatar || avatar.indexOf(CLOUD_PREFIX) === 0) return
  if (!cloudReady()) return
  const fileID = await uploadAvatar(avatar, '')
  if (!fileID || fileID.indexOf(CLOUD_PREFIX) !== 0) return
  writeLocal({ avatar: fileID })
  const r = await fetchCloudDoc(openid)
  if (!r.ok || !r.doc) return
  try {
    await db().collection(COLLECTION).doc(r.doc._id).update({ data: { avatar: fileID, updatedAt: Date.now() } })
    console.log('[cloud] 本机头像已迁移至云存储')
  } catch (e) {
    console.warn('[cloud] 头像迁移写回云端失败', e)
  }
}

/**
 * 保存用户资料：本地持久化 → 上传云存储 → 云端 upsert。
 * profile: { avatar, nickname }
 * 返回 { avatar, nickname, synced }：synced 表示云端是否真的写成功（供 UI 说实话）。
 */
async function saveProfile(profile) {
  const local = readLocal()
  const patch = profile || {}

  let avatar = patch.avatar !== undefined ? patch.avatar : (local.avatar || '')

  // 1) 临时文件 → 持久化到 USER_DATA_PATH
  if (needsPersist(avatar)) {
    try {
      const saved = `${wx.env.USER_DATA_PATH}/avatar_${Date.now()}.png`
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().copyFile({
          srcPath: avatar, destPath: saved, success: resolve, fail: reject,
        })
      })
      avatar = saved
    } catch (e) {
      console.warn('[cloud] 头像持久化失败，使用临时路径', e)
    }
  }

  // 2) 换成新头像 → 顺带删掉不再引用的旧本机文件（云端旧文件在 uploadAvatar 里删）
  if (avatar && avatar !== local.avatar && local.avatar && local.avatar.indexOf(wx.env.USER_DATA_PATH) === 0) {
    wx.getFileSystemManager().unlink({ filePath: local.avatar, fail: () => {} })
  }

  // 3) 上传云存储（失败则保留本机路径，跨设备会丢但本机可用）
  if (avatar && avatar !== local.avatar) {
    avatar = await uploadAvatar(avatar, local.avatar)
  }

  const nickname = patch.nickname !== undefined ? patch.nickname : (local.nickname || '')
  const data = { avatar: avatar || '', nickname: nickname || '' }

  // 4) 本地缓存立即生效
  writeLocal(data)

  // 5) 云端 upsert（先查后写，避免 docId 丢失后 add 出重复记录）
  let synced = false
  if (cloudReady()) {
    try {
      const openid = await getOpenid()
      if (openid) {
        const r = await fetchCloudDoc(openid)
        if (r.ok) {
          // 只有「查询确实成功、且确认没有记录」才 add；查询失败时宁可这次不同步，
          // 也不能冒出一条重复记录（用户会在同一个人名下看到两份资料）。
          const payload = { ...data, updatedAt: Date.now() }
          if (r.doc) {
            await db().collection(COLLECTION).doc(r.doc._id).update({ data: payload })
          } else {
            await db().collection(COLLECTION).add({ data: { ...payload, createdAt: Date.now() } })
          }
          synced = true
        }
      }
    } catch (e) {
      console.warn('[cloud] 用户资料云端同步失败（请检查 users 集合是否创建、权限是否正确）', e)
    }
  }

  return { ...data, synced }
}

// ---------- 删除个人资料（v1.1.3） ----------

/**
 * 查出当前用户**全部**云端资料记录（正常 1 条；老实现可能遗留重复记录）。
 * 返回 { ok, docs }：ok=false 表示「查询本身失败」，与 ok=true,docs=[]（确无记录）严格区分——
 * 删除流程里把这两者混淆的后果是「删了个不存在的记录」却报成功。
 */
async function fetchCloudDocs(openid) {
  if (!openid) return { ok: false, docs: [] }
  try {
    const res = await db().collection(COLLECTION).where({ _openid: openid }).limit(MAX_DOCS).get()
    return { ok: true, docs: (res && res.data) || [] }
  } catch (e) {
    console.warn('[cloud] 查询云端资料失败，无法确认删除结果（请检查 users 集合与权限）', e)
    return { ok: false, docs: [] }
  }
}

/**
 * 删除云存储上的一个头像文件。
 * 返回 true 表示「目标状态已达成」（删除成功，或文件本就不存在）；false 表示删除失败。
 * 「文件不存在」必须算成功：否则记录删除失败后重试会永远卡在同一个文件上，删除流程无法收敛。
 */
function deleteCloudFile(fileID) {
  return new Promise((resolve) => {
    if (!fileID || fileID.indexOf(CLOUD_PREFIX) !== 0) return resolve(true)
    try {
      wx.cloud.deleteFile({
        fileList: [fileID],
        success: (res) => {
          const list = res && res.fileList
          if (!Array.isArray(list) || !list.length) return resolve(true)
          const item = list[0] || {}
          if (item.status === 0) return resolve(true)
          if (/not\s*exist|no such file|不存在/i.test(item.errMsg || '')) return resolve(true)
          console.warn('[cloud] 云存储头像删除失败', item.errMsg || item)
          resolve(false)
        },
        fail: (e) => {
          console.warn('[cloud] 云存储头像删除请求失败', e)
          resolve(false)
        },
      })
    } catch (e) {
      resolve(false)
    }
  })
}

/** 删除本机文件（仅限 USER_DATA_PATH 下自有文件；临时路径不属于本小程序，不碰） */
function removeLocalAvatar(path) {
  return new Promise((resolve) => {
    if (!path || path.indexOf(wx.env.USER_DATA_PATH) !== 0) return resolve(false)
    try {
      wx.getFileSystemManager().unlink({
        filePath: path,
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch (e) {
      resolve(false)
    }
  })
}

/**
 * 清除我的资料：云端数据库记录 + 云存储头像文件 + 本机缓存与本地头像文件。
 *
 * 返回 { ok, cloudDeleted, cloudEmpty, cloudSkipped, localCleared, reason }
 *   ok=false 时 reason 说明卡在哪一步（见上面三条硬约束），页面据此如实提示，
 *   并引导用户重试或走「联系客服」——绝不静默当成成功。
 *
 * 注意：只清「个人资料」。模板 / 收藏 / 打印历史都是本机数据，不在删除范围内
 * （页面文案要讲清楚，避免用户以为整个小程序的数据都被清了）。
 */
async function clearProfile() {
  const local = readLocal()
  const result = {
    ok: false,
    cloudDeleted: false,   // 云端确有记录且已删除
    cloudEmpty: false,     // 云端可达，但确实没有记录（等价于「本来就没有」）
    cloudSkipped: false,   // 云能力未初始化 → 判定本机从未写入过云端
    localCleared: false,
    reason: '',
  }
  const fail = (reason) => {
    result.reason = reason
    return result
  }

  if (cloudReady()) {
    const openid = await getOpenid()
    if (!openid) return fail('cloud_unreachable')

    const r = await fetchCloudDocs(openid)
    if (!r.ok) return fail('cloud_query_failed')

    if (r.docs.length) {
      // ① 先删文件：删不掉就保留记录（fileID 是重试的唯一线索）
      const files = r.docs.map((d) => d.avatar).filter((a) => a && a.indexOf(CLOUD_PREFIX) === 0)
      for (let i = 0; i < files.length; i++) {
        const done = await deleteCloudFile(files[i])
        if (!done) return fail('cloud_file_delete_failed')
      }
      // ② 再删记录：逐个删，中途失败即如实返回（已删的记不下来，重试会跳过不存在的文件）
      for (let i = 0; i < r.docs.length; i++) {
        try {
          await db().collection(COLLECTION).doc(r.docs[i]._id).remove()
        } catch (e) {
          console.warn('[cloud] 删除云端资料记录失败', e)
          return fail('cloud_doc_delete_failed')
        }
      }
      result.cloudDeleted = true
    } else {
      result.cloudEmpty = true
    }
  } else {
    // cloudReady=false ⇒ saveProfile 的云端分支从未执行 ⇒ 云端没有本人资料
    result.cloudSkipped = true
  }

  // 云端已删干净（或确无记录 / 从未上云）→ 才动本机。
  // 连 openid 一起清掉：它是与用户绑定的标识，留着不符合「清除个人资料」的语义；
  // 下次保存时会重新向 login 云函数取一次（openid 永久不变，代价仅为一次云函数调用）。
  try {
    wx.removeStorageSync(PROFILE_KEY)
    result.localCleared = true
  } catch (e) {
    console.warn('[cloud] 本机资料缓存清除失败', e)
  }
  // 本机头像文件必须在这里删：zsda_profile 清空后，cache.sweepAvatars 因「解析不出当前头像」
  // 会保守地零删除（宁可留垃圾不删错），那条路径指望不上。
  await removeLocalAvatar(local.avatar)
  // 头像若已迁到云存储，profile 里只剩 fileID、本机那张 png 就成了路径无从定位的孤儿，
  // removeLocalAvatar 够不着，故补一次按白名单的全量清理（详见 cache.purgeAvatars 注释）。
  try {
    await require('./cache').purgeAvatars()
  } catch (e) {
    // 本机残留一张头像图不构成用户诉求的失败（他关心的是账号资料），只记日志
    console.warn('[cloud] 本机头像文件清理失败', e)
  }

  result.ok = true
  return result
}

module.exports = {
  loadProfile, saveProfile, clearProfile, getOpenid, cloudReady, PROFILE_KEY,
}
