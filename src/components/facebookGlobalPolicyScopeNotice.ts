/**
 * Facebook 全局运行数值合并成「跨全部运行目标唯一一份」之后，误改的代价不再被部署目标吸收：
 * 合并前在 dev 后台改错，最多试坏一个测试环境；合并后同一次保存直接改变线上行为，
 * 而且两侧都会照新值如实运行、不会有任何一处报错。
 *
 * 因此下面这几段文案不是页面装饰，它们是这条能力唯一的、面向人的防误闸：
 * 页面标注与写入确认两处 MUST 同时呈现，删任意一处都等于把闸拆了。
 */

/** 页面标注：Facebook 全局运行数值。 */
export const FACEBOOK_GLOBAL_POLICY_SCOPE_TITLE =
  '本页配置对全部运行目标同时生效，包含线上（OL）';

export const FACEBOOK_GLOBAL_POLICY_SCOPE_DETAIL =
  '这些数值跨运行目标只存一份：在任意一个后台保存，dev 与线上（OL）会同时换用新值，没有「先在 dev 试一下」这一步。'
  + '标题上的 DEV / OL 标签只说明你当前连的是哪台后台，不表示改动只作用于它。'
  + '改错会直接改变线上账号的浏览、点赞、加群与冷启动配额，两边都会照新值如实运行、不会报错。';

/** 写入确认：Facebook 全局运行数值。 */
export const FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_TITLE =
  '保存后线上（OL）会同时改用新值';

export const FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_DETAIL =
  '本次保存对全部运行目标同时生效：不只作用于当前后台，线上账号的运行数值会一起改变，也没有只回滚一侧的办法。'
  + '确认前请逐格核对改动。';

/** 页面标注：入群后评论延迟（独立保存的子卡片，运营可能只看到它）。 */
export const FACEBOOK_GROUP_COMMENT_SCOPE_TITLE =
  '入群后评论延迟同样对全部运行目标同时生效，包含线上（OL）';

export const FACEBOOK_GROUP_COMMENT_SCOPE_DETAIL =
  '这一格与消费节奏分开保存，但存的仍是跨运行目标唯一的一份：保存后 dev 与线上（OL）的账号会同时改用新的等待时长。';

/** 写入确认：入群后评论延迟。 */
export const FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_TITLE =
  '保存后线上（OL）会同时改用新的等待时长';

export const FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_DETAIL =
  '入群后首次评论等待对全部运行目标同时生效：本次保存会一起改变线上账号加入群组后最早何时可首次评论。';
