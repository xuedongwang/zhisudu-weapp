// pages/about/about.js
// 关于：版本信息 + 更新历史

const track = require('../../utils/track')
const store = require('../../utils/store')
const { CURRENT_VERSION } = require('../../utils/version')

// 更新历史（VERSIONS）填写规则（用户 2026-09-23 确定）：
// 只记录**正式发布**的线上版本——每发布一个版本，在这里追加一条（新条目放数组最前）。
// 开发期的版本演进（v1.1.x / v1.2.x 等内部迭代）不进这里，记录在 PRD 与 git 历史。
// 数组为空时页面显示空态提示（about.wxml 已有兜底），属正常状态，不是缺陷。
//
// ⚠️ 新增版本条目时，`version` 必须与 utils/version.js 的 CURRENT_VERSION **逐字一致**
// （目前格式为 `v1.1.0`）。二者不一致会导致「我的」页 NEW 徽标错判——见下方 markNew。

const VERSIONS = [
  {
    version: 'v1.1.0',
    title: '纸型更多 · 形式更多 · 一次打一套',
    date: '2026-09-24',
    items: [
      '纸型扩至 24 种：新增横线纸、竖线纸、方格纸、点阵纸、空白纸、草图纸、书法格（十字/对角/回宫/九宫自由组合）、等距网格、吉他六线谱、分镜纸、会议记录纸、项目规划纸',
      '纸张规格扩至 10 种 + 自定义尺寸：新增 Letter、Executive、A3、B4、Legal、Tabloid，也可自设宽高（50~346mm）',
      '形式层上新：11 种线色、线条粗细、7 种背景色、4 种背景纹理、3 种页面边框、文字水印与 4 款主题，一键拼出想要的纸',
      '批量导出「一次打一套」：从最近生成或打印历史多选（最多 9 张），一次生成、逐张存入相册',
      '适配 iPad 与电脑端：大屏自动切换多列布局，字号与间距不再被放大，内容居中限宽',
      '导出更稳：大图导出前后双重校验，异常自动降档重试并说明原因',
    ],
  },
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

/**
 * 给每条版本打上「用户是否还没看过」的标记（页面据此显示 NEW 角标）。
 *
 * VERSIONS 的**新条目在前**，故从头部往下走，直到遇到「上次已读版本」为止，
 * 途中经过的都是用户没看过的。
 *
 * 两个边界：
 *   - seen 为空 = 从未记录过（首次安装，或本功能引入前就在用的老用户）→ **一条都不标**。
 *     新装用户看到「有更新」是体验缺陷（他装的就是最新版），而这两种情形在 storage 里
 *     没有任何可靠信号可区分，故取「不打扰」这一侧。代价见 mine.js 的 _hasNewVersion。
 *   - seen 不在数组里（已读的版本条目已被下架/改名）→ 走到头，全部标记为未读。
 *     宁多提示、不漏提示：漏一次用户就永远不知道有更新。
 */
function markNew(versions, seen) {
  const out = []
  let reached = !seen
  versions.forEach((v) => {
    if (!reached && v.version === seen) reached = true
    out.push({ ...v, isNew: !reached })
  })
  return out
}

Page({
  data: {
    // 初始一律不带角标（seen 传空 = 一条都不标），onLoad 里再按真实已读版本重算。
    // 这样模板里的 `item.isNew` 在任何时刻都有确定值，不依赖「setData 必然先于首帧渲染」
    // 这条不写在文档里的约定——多花一次 markNew 换取首帧状态的确定性，值。
    versions: markNew(VERSIONS, ''),
    currentVersion: CURRENT_VERSION,
  },
  onLoad() {
    track.pageView('about')
    // ⚠️ 取「已读版本」必须发生在**写标记之前**（取进变量即可）。
    //    真正的坑不是语句先后，而是**写完再重新读**：那时读到的是刚写入的新版本号，
    //    markNew 会判定「全部已读」→ 一条都不标新，而「我的」页的 NEW 徽标又已消失，
    //    用户永远看不到更新内容，且没有任何报错。（此坑由反向测试确认，见 PRD 变更记录）
    const seen = store.getVersionSeen()
    this.setData({ versions: markNew(VERSIONS, seen) })
    // 「点进来即视为已看过」：返回「我的」页时 onShow 会重算 → NEW 徽标消失。
    // 放 onLoad 而不是 onShow：navigateTo 每次进入都会重建页面实例、onLoad 同样每次都跑；
    // 且标记语义是「看过这一版」，与在页面里停留多久无关（误触进入的损失可忽略）。
    store.setVersionSeen(CURRENT_VERSION)
  },
})
