// utils/exporter.js
// 高清导出：离屏 canvas 按 DPI 档位逐档尝试，失败自动降级（PRD FR-06.2）。
// 阶段 0 验证结论：优先 canvas.toDataURL → 写入本地文件（真机兼容性最好），
// 失败回退 wx.canvasToTempFilePath。

const draw = require('./draw')

// DPI 档位表：A4 纵向像素尺寸；横向时宽高互换
const DPI_TABLE = [
  { dpi: 300, widthPx: 2480, heightPx: 3508 },
  { dpi: 200, widthPx: 1654, heightPx: 2339 },
]

// 离屏 canvas → 临时文件（PNG）
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
 * params: { type, cell, margin, color, style, cols, orient }
 * 返回: { tempPath, dpi, widthPx, heightPx, downgraded, durationMs }
 * 全部档位失败时 reject
 */
async function generateImage(params) {
  const t0 = Date.now()
  for (let i = 0; i < DPI_TABLE.length; i++) {
    const config = DPI_TABLE[i]
    try {
      const landscape = params.orient === 'l'
      const w = landscape ? config.heightPx : config.widthPx
      const h = landscape ? config.widthPx : config.heightPx

      const off = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      // 部分基础库版本对构造参数支持不一致，显式再赋值一次
      off.width = w
      off.height = h
      const ctx = off.getContext('2d')
      if (!ctx) throw new Error('getContext("2d") 返回为空')

      draw.drawPaper(ctx, {
        ...params,
        widthPx: w,
        heightPx: h,
        pxPerMm: config.dpi / 25.4,
      })

      const tempPath = await canvasToFile(off)
      return {
        tempPath,
        dpi: config.dpi,
        widthPx: w,
        heightPx: h,
        downgraded: config.dpi !== 300,
        durationMs: Date.now() - t0,
      }
    } catch (e) {
      console.warn(`[export] ${config.dpi}DPI 失败`, (e && e.errMsg) || e)
      if (i === DPI_TABLE.length - 1) {
        throw new Error('所有 DPI 档位均失败，请检查设备兼容性')
      }
      // 继续尝试下一档
    }
  }
}

module.exports = { generateImage, DPI_TABLE }
