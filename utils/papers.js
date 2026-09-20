// utils/papers.js
// 纸型定义 —— 与 PRD v1.0.2「FR-01 纸张类型选择」参数表一致，单一数据源。
// cell: 可调参数（格宽/行高/线距），单位 mm，{min, max, def, step, label}

const PAPERS = {
  tianzige: {
    key: 'tianzige',
    name: '田字格',
    desc: '汉字练习 · 默认格宽 12mm',
    cell: { min: 8, max: 20, def: 12, step: 0.5, label: '格宽' },
  },
  mizige: {
    key: 'mizige',
    name: '米字格',
    desc: '笔顺定位 · 默认格宽 14mm',
    cell: { min: 8, max: 20, def: 14, step: 0.5, label: '格宽' },
  },
  pinyin: {
    key: 'pinyin',
    name: '拼音四线三格',
    desc: '拼音书写 · 默认行高 18mm',
    cell: { min: 12, max: 24, def: 18, step: 0.5, label: '行高' },
  },
  pinyintian: {
    key: 'pinyintian',
    name: '拼音田字格',
    desc: '四线 + 田字格组合 · 默认格宽 12mm',
    cell: { min: 10, max: 18, def: 12, step: 0.5, label: '格宽' },
  },
  kousuan: {
    key: 'kousuan',
    name: '口算纸',
    desc: '空白算式格 · 支持分栏',
    cell: { min: 14, max: 28, def: 20, step: 0.5, label: '格宽' },
    hasCols: true,
  },
  english: {
    key: 'english',
    name: '英语四线三格',
    desc: '英文书写 · 默认行高 15mm',
    cell: { min: 10, max: 22, def: 15, step: 0.5, label: '行高' },
  },
  zuowen: {
    key: 'zuowen',
    name: '作文方格纸',
    desc: '400 格/页（估算） · 默认格宽 8mm',
    cell: { min: 7, max: 10, def: 8, step: 0.5, label: '格宽' },
  },
  kongbi: {
    key: 'kongbi',
    name: '控笔纸',
    desc: '曲线描红 · 运笔训练',
    cell: { min: 8, max: 20, def: 12, step: 0.5, label: '线距' },
  },
}

// 线条颜色（与原型一致）
const COLORS = [
  { value: '#333333', name: '黑' },
  { value: '#9A9A92', name: '灰' },
  { value: '#D9534F', name: '红' },
  { value: '#3B6FB5', name: '蓝' },
  { value: '#2E8B57', name: '绿' },
]

// 线条样式
const STYLES = [
  { value: 'solid', name: '实线' },
  { value: 'dash', name: '虚线' },
  { value: 'dot', name: '点线' },
]

// A4 尺寸（mm，纵向）
const A4 = { widthMm: 210, heightMm: 297 }

// 默认参数
function defaultParams(key) {
  const p = PAPERS[key]
  return {
    type: key,
    cell: p.cell.def,
    margin: 10, // 边距 5-25mm，默认 10mm（PRD FR-02.5）
    color: COLORS[0].value,
    style: STYLES[0].value,
    cols: 2, // 口算纸分栏，默认 2 栏（PRD FR-02.6）
    orient: 'p', // p 纵向 / l 横向
  }
}

module.exports = { PAPERS, COLORS, STYLES, A4, defaultParams }
