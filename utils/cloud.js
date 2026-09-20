// utils/cloud.js
// 云开发能力封装：openid 获取 + 用户资料（头像/昵称）云端同步。
// 依赖：云开发控制台已创建 users 集合（权限：仅创建者可读写）。
// 云不可用时全部静默降级为本地存储，不阻塞页面功能。

const PROFILE_KEY = 'zsda_profile' // 本地缓存：{ avatar, nickname, docId }

function cloudReady() {
  return !!(wx.cloud && getApp() && getApp().globalData.cloudReady)
}

function db() {
  return wx.cloud.database()
}

/**
 * 获取用户资料（本地优先，云异步补齐）
 * 回调式：cb(profile)
 */
function loadProfile(cb) {
  const local = wx.getStorageSync(PROFILE_KEY)
  if (local && (local.avatar || local.nickname)) cb(local)
  if (!cloudReady()) return
  const docId = local && local.docId
  if (!docId) return
  db().collection('users').doc(docId).get()
    .then((res) => {
      if (res.data) cb({ ...res.data, docId })
    })
    .catch(() => {})
}

/**
 * 保存用户资料（头像临时文件需先复制到用户目录持久化）
 * profile: { avatar, nickname }
 */
async function saveProfile(profile) {
  // 1) 头像临时文件 → 持久化到 USER_DATA_PATH
  let avatar = profile.avatar
  if (avatar && avatar.indexOf('wxfile://tmp') === 0 || (avatar && avatar.indexOf('http://tmp') === 0)) {
    try {
      const saved = `${wx.env.USER_DATA_PATH}/avatar_${Date.now()}.png`
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().copyFile({
          srcPath: avatar, destPath: saved, success: resolve, fail: reject,
        })
      })
      // 清理旧头像文件
      const old = (wx.getStorageSync(PROFILE_KEY) || {}).avatar
      if (old && old.indexOf(wx.env.USER_DATA_PATH) === 0) {
        wx.getFileSystemManager().unlink({ path: old, fail: () => {} })
      }
      avatar = saved
    } catch (e) {
      console.warn('[cloud] 头像持久化失败，使用临时路径', e)
    }
  }

  const local = wx.getStorageSync(PROFILE_KEY) || {}
  const data = { avatar: avatar || local.avatar || '', nickname: profile.nickname || local.nickname || '' }
  data.docId = local.docId

  // 2) 本地缓存立即生效
  wx.setStorageSync(PROFILE_KEY, data)

  // 3) 云端同步（失败不阻塞）
  if (!cloudReady()) return data
  try {
    if (data.docId) {
      await db().collection('users').doc(data.docId).update({ data: { ...data, updatedAt: Date.now() } })
    } else {
      const res = await db().collection('users').add({
        data: { ...data, createdAt: Date.now(), updatedAt: Date.now() },
      })
      data.docId = res._id
      wx.setStorageSync(PROFILE_KEY, data)
    }
  } catch (e) {
    console.warn('[cloud] 用户资料云端同步失败（请检查 users 集合是否创建）', e)
  }
  return data
}

/** 获取 openid（登录云函数） */
function getOpenid() {
  if (!cloudReady()) return Promise.resolve(null)
  return wx.cloud.callFunction({ name: 'login' })
    .then((res) => (res.result && res.result.openid) || null)
    .catch(() => null)
}

module.exports = { loadProfile, saveProfile, getOpenid, PROFILE_KEY }
