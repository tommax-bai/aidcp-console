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
