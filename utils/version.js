// utils/version.js
// 版本号单一数据源。
//
// 为什么单独抽出来：原先「当前版本」硬编码在 `pages/about/about.wxml` 与
// `pages/mine/mine.wxml` 两处，升到 v1.1.x 后两处都还写着 v1.0.0——
// 属于典型的「文档已升版、界面没跟上」。
// 此后升版只需改这里一处，外加 `pages/about/about.js` 的 VERSIONS 首条。

const CURRENT_VERSION = 'v1.2.2'

module.exports = { CURRENT_VERSION }
