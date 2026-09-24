// utils/exporter.js
// 高清导出：离屏 canvas 按 DPI 档位逐档尝试，失败自动降级（PRD FR-06.2）。
// 阶段 0 验证结论：优先 canvas.toDataURL → 写入本地文件（真机兼容性最好），
// 失败回退 wx.canvasToTempFilePath。
//
// v1.1：像素尺寸不再硬编码 A4，改为「纸张规格 mm × dpi」现算（FR-17）。
// A4/300DPI 现算结果仍为 2480×3508、200DPI 为 1654×2339，与旧硬编码值逐值一致。

const draw = require('./draw')
const papers = require('./papers')

// DPI 档位：300 高清 → 200 低配降级
const DPI_LEVELS = [300, 200]

// 兼容保留：A4 两档像素表（旧代码若引用）
const DPI_TABLE = DPI_LEVELS.map((dpi) => {
  const px = papers.pixelSize('a4', 'p', dpi)
  return { dpi, widthPx: px.w, heightPx: px.h }
})

// 离屏 canvas → 本地文件（PNG）
function canvasToFile(canvas) {
  return new Promise((resolve, reject) => {
    const tryToTempFilePath = () =>
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: reject,
      })
    try {
      if (typeof canvas.toDataURL === 'function') {
        const dataUrl = canvas.toDataURL('image/png')
        if (dataUrl && dataUrl.indexOf('data:image/png;base64,') === 0) {
          const base64 = dataUrl.substring('data:image/png;base64,'.length)
          const filePath = `${wx.env.USER_DATA_PATH}/paper_${Date.now()}.png`
          wx.getFileSystemManager().writeFile({
            filePath,
            data: base64,
            encoding: 'base64',
            success: () => resolve(filePath),
            fail: tryToTempFilePath, // 写文件失败回退
          })
          return
        }
      }
    } catch (e) {
      console.warn('[export] toDataURL 失败，回退 canvasToTempFilePath', e)
    }
    tryToTempFilePath()
  })
}

/**
 * 生成高清图
 * params: 归一化后的整页参数 {size, orient, margin, color, style, layout, blocks}
 *         （旧的扁平参数也能传入，内部会先归一化）
 * 返回: { tempPath, dpi, widthPx, heightPx, downgraded, durationMs, size, layout, blocks }
 * 全部档位失败时 reject
 */
async function generateImage(params) {
  const n = papers.normalizeParams(params)
  const t0 = Date.now()
  for (let i = 0; i < DPI_LEVELS.length; i++) {
    const dpi = DPI_LEVELS[i]
    try {
      const px = papers.pixelSize(n.size, n.orient, dpi)

      const off = wx.createOffscreenCanvas({ type: '2d', width: px.w, height: px.h })
      // 部分基础库版本对构造参数支持不一致，显式再赋值一次
      off.width = px.w
      off.height = px.h
      const ctx = off.getContext('2d')
      if (!ctx) throw new Error('getContext("2d") 返回为空')

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
        widthPx: px.w,
        heightPx: px.h,
        pxPerMm: dpi / 25.4,
      })

      const tempPath = await canvasToFile(off)
      return {
        tempPath,
        dpi,
        widthPx: px.w,
        heightPx: px.h,
        downgraded: dpi !== DPI_LEVELS[0],
        durationMs: Date.now() - t0,
        size: n.size,
        orient: n.orient,
        layout: n.layout,
        blocks: n.blocks,
      }
    } catch (e) {
      console.warn(`[export] ${dpi}DPI 失败`, (e && e.errMsg) || e)
      if (i === DPI_LEVELS.length - 1) {
        throw new Error('所有 DPI 档位均失败，请检查设备兼容性')
      }
      // 继续尝试下一档
    }
  }
}

module.exports = { generateImage, DPI_TABLE, DPI_LEVELS }
