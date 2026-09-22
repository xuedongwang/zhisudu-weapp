// utils/schema.js
// 本机存储结构定义（**单一数据源**）：storage key、各列表上限、需同步的字段。
//
// 为什么单独抽出来：v1.2.0 起 utils/sync.js 也要读写这些 key 与上限，
// 而 store.js 的写路径需要调 sync（写本机 → 异步推云）。若两者直接互相 require
// 会形成循环依赖（小程序 CommonJS 下会拿到不完整的 exports，且失败是静默的）。
// 抽成独立模块后两边都依赖它，**key 与上限只有一处定义**，不会改一处漏一处。
// 同类先例：utils/version.js（版本号单一数据源）。
//
// 此前存在的不一致（本次一并收口）：
//   - 'zsda_profile' 在 cloud.js（PROFILE_KEY）与 cache.js（第 106 行）各写了一遍字面量；
//   - 三个上限常量原先只存在于 store.js，sync.js 做合并截断时拿不到，只能复制一份。

const KEYS = {
  templates: 'zsda_templates',        // 自定义模板（上限 20）
  favs: 'zsda_favs',                  // 收藏的纸型 key 列表
  recent: 'zsda_recent',              // 最近生成记录（上限 10）
  history: 'zsda_history',            // 打印历史流水（上限 50）
  historyTotal: 'zsda_history_total', // 累计导出张数（独立计数，不受列表截断影响）
  profile: 'zsda_profile',            // 用户资料：{ avatar, nickname, openid }
  meta: 'zsda_sync',                  // 同步元信息：{ initialized, docId, pending, lastSyncAt }
}

// 列表上限（PRD FR-09.1 / FR-10.1 / FR-16）。合并两岸数据时同样受此约束。
const LIMITS = {
  templates: 20,
  recent: 10,
  history: 50,
}

// 需要跨设备同步的字段。
// empty = 「本机该 key 被清掉」时上云的值（clearHistory 用的是 removeStorageSync，
// 若不显式给空值，会把 undefined 推上云，表现为「删了又回来」）。
const SYNC_FIELDS = {
  templates: { key: KEYS.templates, empty: [] },
  favs: { key: KEYS.favs, empty: [] },
  recent: { key: KEYS.recent, empty: [] },
  history: { key: KEYS.history, empty: [] },
  historyTotal: { key: KEYS.historyTotal, empty: 0 },
}

const SYNC_FIELD_NAMES = Object.keys(SYNC_FIELDS)

module.exports = { KEYS, LIMITS, SYNC_FIELDS, SYNC_FIELD_NAMES }
