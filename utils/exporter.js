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
// v1.4：起始档由规格的基准 DPI 决定（papers.dpiForSize）——A3/B4/Legal/Tabloid
// 固定从 200 起（用户拍板「超限档自动 200DPI」，不是降级）；失败时再向下一档兜底。
const DPI_LEVELS = [300, 200]

function dpiLevelsFor(sizeKey) {
  return papers.dpiForSize(sizeKey) >= 300 ? [300, 200] : [200, 150]
}

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

// ---------- v1.4 导出读回校验（RK-10 静默失败兜底）----------
// 背景：大尺寸逼近 iOS 画布墙时，canvas 可能「不报错但产出空白/残图」——
// draw 调用全部正常返回，toDataURL 也能跑，用户拿到的却是一张白纸。
// 因此导出不再「调通即成功」，加两道事实校验，失败即降档重试。

// 校验①：画布内容非空白抽查。把画好的画布缩绘到小尺寸，统计与背景色不同的像素。
// ⚠️ 豁免：全部区块都是空白纸（kongbai）时全白是**合法输出**（见 draw.js 空白纸注释），
//    只校验尺寸不校验内容。豁免名单若扩到「其他合法全白纸型」必须同步改这里与 v1.5 批量校验。
function verifyCanvasContent(off, n, bgColor) {
  const allBlank = (n.blocks || []).every((b) => b.type === 'kongbai')
  if (allBlank) return
  const TW = 64
  const TH = Math.max(1, Math.round((off.height / off.width) * TW))
  const probe = wx.createOffscreenCanvas({ type: '2d', width: TW, height: TH })
  probe.width = TW
  probe.height = TH
  const pctx = probe.getContext('2d')
  if (!pctx) return // 探测画布不可用：不阻塞主流程（校验②仍把守文件层）
  pctx.drawImage(off, 0, 0, TW, TH)
  const data = pctx.getImageData(0, 0, TW, TH).data
  // 背景色 RGB（缺省纯白）
  const hex = /^#([0-9a-fA-F]{6})$/.exec(bgColor || '#FFFFFF')
  const br = hex ? parseInt(hex[1].slice(0, 2), 16) : 255
  const bg = hex ? parseInt(hex[1].slice(2, 4), 16) : 255
  const bb = hex ? parseInt(hex[1].slice(4, 6), 16) : 255
  let diff = 0
  const total = TW * TH
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - br) > 24 || Math.abs(data[i + 1] - bg) > 24 || Math.abs(data[i + 2] - bb) > 24) diff++
  }
  // 一个内容像素都没有 = 静默空白图，判失败（触发降档重试）
  if (diff === 0) throw new Error('导出内容为空（疑似静默失败），正在降档重试')
}

// 校验②：落盘文件的真实像素尺寸。getImageInfo 读回宽高，与期望值比对，
// 防止「画布正常但编码/写盘产出残图」。
function verifyImageFile(filePath, px) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        if (Math.abs(info.width - px.w) > 2 || Math.abs(info.height - px.h) > 2) {
          reject(new Error(`导出文件尺寸异常（${info.width}×${info.height}，期望 ${px.w}×${px.h}），正在降档重试`))
          return
        }
        resolve()
      },
      fail: () => reject(new Error('导出文件不可读，正在降档重试')),
    })
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
  const custom = { w: n.customW, h: n.customH }
  const levels = dpiLevelsFor(n.size)
  for (let i = 0; i < levels.length; i++) {
    const dpi = levels[i]
    try {
      const px = papers.pixelSize(n.size, n.orient, dpi, custom)

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

      // v1.4 校验①：画布内容非空白（全空白纸型豁免，见函数注释）
      verifyCanvasContent(off, n, n.bgColor)

      const tempPath = await canvasToFile(off)
      // v1.4 校验②：落盘文件真实像素尺寸
      await verifyImageFile(tempPath, px)

      return {
        tempPath,
        dpi,
        widthPx: px.w,
        heightPx: px.h,
        downgraded: dpi !== levels[0],
        durationMs: Date.now() - t0,
        size: n.size,
        orient: n.orient,
        layout: n.layout,
        blocks: n.blocks,
      }
    } catch (e) {
      console.warn(`[export] ${dpi}DPI 失败`, (e && e.errMsg) || e)
      if (i === levels.length - 1) {
        // 把最后一次失败的原因带出去（静默空白 / 尺寸异常 / 兼容性），便于排查
        const reason = (e && e.message) || (e && e.errMsg) || ''
        throw new Error(`所有 DPI 档位均失败${reason ? `：${reason}` : '，请检查设备兼容性'}`)
      }
      // 继续尝试下一档
    }
  }
}

module.exports = { generateImage, DPI_TABLE, DPI_LEVELS }
