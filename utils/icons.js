// utils/icons.js
// SVG 图标集：小程序 <image> 组件通过 data URI 渲染 SVG。
// 颜色统一用 CSS 变量对应的字面值（组件内不支持 var()）。

function svgUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const INK = '#2B2B28'
const SUB = '#8A897F'
const AMBER = '#F5A623'
const GREEN = '#0E8A6D'

const ICONS = {
  // 收藏（实心星）
  star: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${AMBER}" d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.35 6.2 20.4l1.1-6.47L2.6 9.35l6.5-.95z"/></svg>`),
  // 收藏（描边星）
  starLine: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="${AMBER}" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.8.85-4.2 4.1.99 5.8L12 16.75l-5.2 2.8.99-5.8-4.2-4.1 5.8-.85z"/></svg>`),
  // 意见反馈（气泡）
  chat: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="${GREEN}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.5v-3.5h-1A2.5 2.5 0 0 1 4 14.5z"/><circle cx="9" cy="10.5" r="1" fill="${GREEN}"/><circle cx="12" cy="10.5" r="1" fill="${GREEN}"/><circle cx="15" cy="10.5" r="1" fill="${GREEN}"/></svg>`),
  // 关于（信息）
  info: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${SUB}" stroke-width="1.8"/><circle cx="12" cy="8" r="1.2" fill="${SUB}"/><path d="M12 11.5v6" stroke="${SUB}" stroke-width="1.8" stroke-linecap="round"/></svg>`),
  // 客服（耳麦）
  headset: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="${GREEN}" stroke-width="1.8" stroke-linecap="round" d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="12.5" width="4" height="6" rx="2" fill="${GREEN}"/><rect x="17" y="12.5" width="4" height="6" rx="2" fill="${GREEN}"/><path fill="none" stroke="${GREEN}" stroke-width="1.8" stroke-linecap="round" d="M19 18.5a4 4 0 0 1-4 2.5h-2"/></svg>`),
  // 右箭头
  chevron: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#C9C7BD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`),
  // 用户（我的页占位头像）
  user: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="#FFFFFF" stroke-width="1.8"/><path fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" d="M5.5 19c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/></svg>`),
}

module.exports = { ICONS }
