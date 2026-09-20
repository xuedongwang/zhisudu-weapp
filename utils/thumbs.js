// utils/thumbs.js
// 纸型缩略图：用离屏 canvas 按默认参数绘制小图并缓存为本地 PNG 文件。
// 首页卡片 / 最近记录 / 我的模板复用，避免页面内塞大量 canvas 节点。

const draw = require('./draw')
const papers = require('./papers')

const THUMB_W = 210
const THUMB_H = 297 // mm 坐标 1:1 像素，thumb 模式加粗线宽

const memoryCache = {}

/**
 * 获取某纸型的缩略图文件路径（默认参数）
 * 返回 Promise<filePath>
 */
function ensureThumb(type) {
  if (memoryCache[type]) return Promise.resolve(memoryCache[type])
  const filePath = `${wx.env.USER_DATA_PATH}/thumb_${type}.png`

  return new Promise((resolve) => {
    // 已有缓存文件直接用
    wx.getFileSystemManager().access({
      path: filePath,
      success: () => {
        memoryCache[type] = filePath
        resolve(filePath)
      },
      fail: () => {
        try {
          const off = wx.createOffscreenCanvas({ type: '2d', width: THUMB_W, height: THUMB_H })
          off.width = THUMB_W
          off.height = THUMB_H
          const ctx = off.getContext('2d')
          if (!ctx) return resolve('')
          const params = papers.defaultParams(type)
          draw.drawPaper(ctx, {
            ...params,
            widthPx: THUMB_W,
            heightPx: THUMB_H,
            pxPerMm: 1,
            thumb: true,
          })
          const dataUrl = off.toDataURL('image/png')
          const base64 = dataUrl.substring('data:image/png;base64,'.length)
          wx.getFileSystemManager().writeFile({
            filePath,
            data: base64,
            encoding: 'base64',
            success: () => {
              memoryCache[type] = filePath
              resolve(filePath)
            },
            fail: () => resolve(''),
          })
        } catch (e) {
          console.warn('[thumbs] 生成失败', type, e)
          resolve('')
        }
      },
    })
  })
}

module.exports = { ensureThumb }
