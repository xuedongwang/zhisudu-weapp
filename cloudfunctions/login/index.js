// cloudfunctions/login/index.js
// 登录云函数：返回用户 openid（静默，无需授权）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
  }
}
