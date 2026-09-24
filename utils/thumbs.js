// utils/thumbs.js
// 纸型 / 版面缩略图：用离屏 canvas 按默认参数绘制小图并缓存为本地 PNG 文件。
// 首页卡片、最近记录、我的模板、打印历史共用，避免页面里塞大量 canvas 节点。
//
// ⚠️ 缓存键必须带版本号（THUMB_VERSION）。
// 原实现的缓存文件名只有纸型 key（thumb_tianzige.png），一旦改了绘制逻辑，
// 老设备上的旧文件仍然存在、access() 命中就直接复用 —— 表现为「改了没生效」，
// 且因为新设备正常，排查成本极高。改绘制逻辑时请同步 +1。

const draw = require('./draw')
const papers = require('./papers')

const THUMB_VERSION = 2
const THUMB_W = 210 // 缩略图宽度固定 210px，高度按纸张比例算

const memoryCache = {}

function posix(parts) {
  return parts.filter((x) => x !== undefined && x !== null && x !== '').join('_')
}

/**
 * 缩略图缓存键：版本 + 规格 + 方向 + 版式 + 各区块纸型
 * 单区块整页时退化为 per-纸型键（与旧行为等价，但多了版本前缀）
 */
function thumbKey(raw) {
  const n = papers.normalizeParams(raw)
  const types = n.blocks.map((b) => b.type).join('-')
  return `thumb_v${THUMB_VERSION}_${posix([n.size, n.orient, n.layout, types])}.png`
}

function filePathOf(key) {
  return `${wx.env.USER_DATA_PATH}/${key}`
}

/**
 * 获取某纸型默认参数的缩略图（首页卡片 / 收藏页用）
 * 返回 Promise<filePath>（失败给空串）
 */
function ensureThumb(type) {
  return ensurePageThumb(papers.defaultParams(type))
}

/**
 * 获取某套整页参数的缩略图（最近记录 / 模板 / 打印历史用）
 * 入参可以是归一化后的结构，也可以是旧的扁平参数
 */
function ensurePageThumb(raw) {
  const n = papers.normalizeParams(raw)
  const key = thumbKey(n)
  if (memoryCache[key]) return Promise.resolve(memoryCache[key])
  const filePath = filePathOf(key)

  return new Promise((resolve) => {
    // 已有缓存文件直接用
    wx.getFileSystemManager().access({
      path: filePath,
      success: () => {
        memoryCache[key] = filePath
        resolve(filePath)
      },
      fail: () => {
        try {
          const mm = papers.pageSizeMm(n.size, n.orient)
          const w = THUMB_W
          const h = Math.round(THUMB_W * (mm.h / mm.w))
          const off = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
          off.width = w
          off.height = h
          const ctx = off.getContext('2d')
          if (!ctx) return resolve('')
          draw.drawPage(ctx, {
            size: n.size,
            orient: n.orient,
            margin: n.margin,
            color: n.color,
            style: n.style,
            weight: n.weight,
            bgColor: n.bgColor,
            bgTexture: n.bgTexture,
            border: n.border,
            wmText: n.wmText,
            wmAlpha: n.wmAlpha,
            wmAngle: n.wmAngle,
            layout: n.layout,
            blocks: n.blocks,
            widthPx: w,
            heightPx: h,
            pxPerMm: 1, // 1px = 1mm，thumb 模式加粗线宽便于小尺寸辨识
            thumb: true,
          })
          const dataUrl = off.toDataURL('image/png')
          const base64 = dataUrl.substring('data:image/png;base64,'.length)
          wx.getFileSystemManager().writeFile({
            filePath,
            data: base64,
            encoding: 'base64',
            success: () => {
              memoryCache[key] = filePath
              resolve(filePath)
            },
            fail: () => resolve(''),
          })
        } catch (e) {
          console.warn('[thumbs] 生成失败', key, e)
          resolve('')
        }
      },
    })
  })
}

module.exports = { ensureThumb, ensurePageThumb, thumbKey, THUMB_VERSION }
