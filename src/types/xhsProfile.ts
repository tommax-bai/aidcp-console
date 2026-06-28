/**
 * 小红书用户主页链接（后台账号昵称 / 通知联系人昵称 → 可点跳转其个人主页）。
 *
 * 主页是「裸 id 链接」：不同于笔记详情页需 xsec_token（裸链 404），/user/profile/<id> 直接可开——
 * 边端「直驱本人主页采昵称」正是裸 id 导航且已真机验证（change account-real-nickname）。
 * 我们的账号 id 即登录派生的小红书 userid（cloud account-store：≥20 位字母数字、绝不等于退役标识 'default'）；
 * 通知联系人的 userId 即从通知行头像 /user/profile/<id> 解析出的同形主页 id。
 */

const XHS_PROFILE_BASE = 'https://www.xiaohongshu.com/user/profile/';

/**
 * 真实小红书用户 id 形状：≥20 位字母数字（与 cloud account-store 的「登录派生 userid」口径对齐）。
 * 用于挡掉退役标识 'default' 与任何非 id 串——形状不符即不给链接（守「绝不渲染死链」红线）。
 */
const XHS_USER_ID_RE = /^[A-Za-z0-9]{20,}$/;

/**
 * 由小红书用户 id 造个人主页链接。
 * 非真实用户 id（空 / 'default' / 形状不符）返回 null，调用方据此回落纯文本、绝不渲染打不开的死链。
 */
export function xhsProfileUrl(userId: string | null | undefined): string | null {
  const id = userId?.trim();
  return id && XHS_USER_ID_RE.test(id) ? `${XHS_PROFILE_BASE}${id}` : null;
}
