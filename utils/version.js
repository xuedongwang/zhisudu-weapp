// utils/version.js
// 版本号单一数据源。
//
// 为什么单独抽出来：原先「当前版本」硬编码在 `pages/about/about.wxml` 与
// `pages/mine/mine.wxml` 两处，升到 v1.1.x 后两处都还写着 v1.0.0——
// 属于典型的「文档已升版、界面没跟上」。
// 此后升版只需改这里一处。
//
// ⚠️ 版本显示口径（用户 2026-09-23 确定）：
// 产品**尚未正式发布**，界面上「当前版本」统一显示 v1.0.0，
// **不随开发期迭代升版**——开发期的版本演进记录在 PRD 与 git 提交历史，
// 不进用户界面。正式提审发布时，才把这里改为当次发布的真实版本号，
// 并在 `pages/about/about.js` 的 VERSIONS 里追加第一条发布记录。

const CURRENT_VERSION = 'v1.0.0'

module.exports = { CURRENT_VERSION }
