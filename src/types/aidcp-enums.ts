/**
 * 风控/告警枚举的 console 端镜像（cloud src/risk/types.ts 的副本）。
 *
 * 唯一源是 cloud `GET /api/version`；本文件 + aidcp-enums.test.ts 对其断言以防三处漂移
 * （design-ui §0/§2、design.md D11）。改这里务必同步 cloud，否则漂移测试失败。
 */

export const RISK_STATUSES = ['normal', 'warned', 'restricted', 'frozen'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_QUOTA_LEVELS = ['conservative', 'normal', 'aggressive'] as const;
export type RiskQuotaLevel = (typeof RISK_QUOTA_LEVELS)[number];

export const RISK_ACTIONS = ['like', 'collect', 'comment', 'follow', 'publish', 'view'] as const;
export type RiskAction = (typeof RISK_ACTIONS)[number];

export const ALERT_SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type EdgeOnlineState = 'online' | 'stale' | 'offline';

// ── 视觉映射（design-ui §2）：status = filled warm / tier = outlined cool，构造级分离 ──

/** STATUS 徽标色（AntD Tag preset，warm 族）。 */
export const RISK_STATUS_COLOR: Record<RiskStatus, string> = {
  normal: 'green',
  warned: 'gold',
  restricted: 'volcano',
  frozen: 'red',
};

/** QUOTA-TIER 徽标色（AntD Tag preset，cool 族；与 status 永不混淆）。 */
export const RISK_QUOTA_COLOR: Record<RiskQuotaLevel, string> = {
  conservative: 'blue',
  normal: 'geekblue',
  aggressive: 'purple',
};

/** 互动动作色（change interaction-feed-enrichment）：四类互动各异色便于区分；未知回落默认灰。 */
export const RISK_ACTION_COLOR: Record<RiskAction, string> = {
  like: 'magenta',
  collect: 'gold',
  comment: 'blue',
  follow: 'green',
  publish: 'purple',
  view: 'default',
};

/** 告警分级色（V1 用；P3 中性灰不抢视觉）。 */
export const ALERT_SEVERITY_COLOR: Record<AlertSeverity, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'gold',
  P3: 'default',
};

/** edge online 三态 → AntD Badge status（绝不二元）。 */
export const EDGE_ONLINE_BADGE: Record<EdgeOnlineState, 'success' | 'warning' | 'default'> = {
  online: 'success',
  stale: 'warning',
  offline: 'default',
};

// ── 枚举 → 中文 label（全站唯一源；UI 渲染中文、内部值不变，防术语漂移）──

/** 风控状态中文 label。 */
export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  normal: '正常',
  warned: '预警',
  restricted: '受限',
  frozen: '冻结',
};

/** 配额档位中文 label。 */
export const RISK_QUOTA_LABEL: Record<RiskQuotaLevel, string> = {
  conservative: '保守',
  normal: '正常',
  aggressive: '激进',
};

/** 互动动作中文 label（复用于按账号计数列头与互动表）。 */
export const RISK_ACTION_LABEL: Record<RiskAction, string> = {
  like: '点赞',
  collect: '收藏',
  comment: '评论',
  follow: '关注',
  publish: '发布',
  view: '浏览',
};

/** 运营态中文 label（durable 暂停，区别于验证码暂停）。 */
export const OPERATOR_STATUS_LABEL: Record<'active' | 'paused', string> = {
  active: '运行中',
  paused: '运营已暂停',
};

/** 边缘端在线三态中文 label。 */
export const EDGE_ONLINE_LABEL: Record<EdgeOnlineState, string> = {
  online: '在线',
  stale: '失联',
  offline: '离线',
};

/** 告警级别中文释义（代号保留，作 tooltip / 副文）。 */
export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  P0: '紧急',
  P1: '严重',
  P2: '警告',
  P3: '提示',
};
