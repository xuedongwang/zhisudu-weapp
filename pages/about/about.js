// pages/about/about.js
// 关于：版本信息 + 更新历史

const track = require('../../utils/track')
const { CURRENT_VERSION } = require('../../utils/version')

// 更新历史（VERSIONS）填写规则（用户 2026-09-23 确定）：
// 只记录**正式发布**的线上版本——每发布一个版本，在这里追加一条（新条目放数组最前）。
// 开发期的版本演进（v1.1.x / v1.2.x 等内部迭代）不进这里，记录在 PRD 与 git 历史。
// 数组为空时页面显示空态提示（about.wxml 已有兜底），属正常状态，不是缺陷。

const VERSIONS = []

Page({
  data: {
    versions: VERSIONS,
    currentVersion: CURRENT_VERSION,
  },
  onLoad() {
    track.pageView('about')
  },
})
