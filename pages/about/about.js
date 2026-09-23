// pages/about/about.js
// 关于：版本信息 + 更新历史

const track = require('../../utils/track')
const { CURRENT_VERSION } = require('../../utils/version')

// 更新历史（VERSIONS）填写规则（用户 2026-09-23 确定）：
// 只记录**正式发布**的线上版本——每发布一个版本，在这里追加一条（新条目放数组最前）。
// 开发期的版本演进（v1.1.x / v1.2.x 等内部迭代）不进这里，记录在 PRD 与 git 历史。
// 数组为空时页面显示空态提示（about.wxml 已有兜底），属正常状态，不是缺陷。

const VERSIONS = [
  {
    version: 'v1.0.0',
    title: '首次发布',
    date: '2026-09-23',
    items: [
      '12 种格线纸：田字格、米字格、拼音四线三格、拼音田字格、英语四线三格、作文方格纸、控笔纸、口算纸、坐标纸、五线谱纸、康奈尔笔记纸、周计划表',
      '4 种纸张规格：A4 / 16K / B5 / A5，支持横向与纵向',
      '单页多区块：整页 / 上下两格 / 上下三格 / 四宫格，一页最多放 4 种纸型',
      '格宽、行高、页边距、线条样式、分栏均可调，参数可存为模板复用',
      '300DPI 高清导出，低配机型自动降至 200DPI；可保存到相册或发送到电脑打印',
      '模板收藏、收藏夹、最近生成、打印历史与累计导出张数，换设备可继续使用',
      '无需登录、无广告、无内购；头像与昵称可选填，并可在「我的」中随时清除',
    ],
  },
]

Page({
  data: {
    versions: VERSIONS,
    currentVersion: CURRENT_VERSION,
  },
  onLoad() {
    track.pageView('about')
  },
})
