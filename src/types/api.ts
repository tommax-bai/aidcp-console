/** 面板 API DTO 类型（与 cloud src/panel 对齐）。 */

import type { RiskStatus, RiskQuotaLevel, RiskAction, AlertSeverity } from './aidcp-enums';

export interface VersionPayload {
  panelApiVersion: number;
  enums: {
    riskStatus: RiskStatus[];
    riskQuotaLevel: RiskQuotaLevel[];
    riskAction: RiskAction[];
    /** V1 task 9.5 落地后补（漂移哨兵）。 */
    alertSeverity: AlertSeverity[];
  };
}

export interface LoginResponse {
  token: string;
  expiresIn: number;
}

export interface MeResponse {
  sub: string;
  panelApiVersion: number;
}

/** 账号一览行（accounts ⨝ risk_state）。operator 态与 risk 态分开 → 两个独立徽标。 */
export interface PanelAccount {
  accountId: string;
  label: string | null;
  platform: string;
  groupLabel: string | null;
  machineLabel: string | null;
  /** 运营暂停态（durable，区别于验证码 pausedEdges）。 */
  operatorStatus: 'active' | 'paused';
  pausedAt: number | null;
  /** 风控状态（账号无风控行时为 null）。 */
  riskStatus: RiskStatus | null;
  riskQuotaLevel: RiskQuotaLevel | null;
  signalCount: number | null;
}

export interface LikeRate {
  likes: number;
  views: number;
  /** likes/views；views=0 时 null。 */
  rate: number | null;
  /** 15%-35% 健康区间；rate=null 时 null。 */
  healthy: boolean | null;
}

/** 今日各 action 计数（全局）+ 今日发布数。 */
export type TodayTotals = Record<RiskAction, number> & { publish: number };

/** 按账号今日计数切片（V1 task 9.6：归因已流通，真按账号）。 */
export interface AccountTotals {
  accountId: string;
  totals: Record<RiskAction, number>;
}

/** 告警事件（V1 task 9.5）。 */
export interface Alert {
  id: number;
  severity: AlertSeverity;
  type: string;
  accountId: string | null;
  title: string;
  detail: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

/** 按笔记互动历史（V1 task 9.2）。 */
export interface PanelInteraction {
  accountId: string;
  noteId: string;
  action: 'like' | 'collect' | 'comment';
  interactedAt: number;
}

/** 调度启停结果（V1 task 9.4）；绝不乐观，回报真实在线 edge 数。 */
export interface DispatchResult {
  accountId: string;
  dispatch: 'started' | 'stopped';
  changed: boolean;
  edgesOnline: number;
}

export interface DashboardSummary {
  asOf: number;
  edgesOnline: number;
  totals: TodayTotals;
  /** V1 task 9.6：真按账号切片（归因已流通）。 */
  totalsByAccount: AccountTotals[];
  likeRate: LikeRate;
  accounts: PanelAccount[];
  /** V1 task 9.5：真未解决告警。 */
  alerts: Alert[];
  /** 归因已落地（V1 task 9.6）：恒 false；保留字段供旧前端兼容。 */
  attributionPending: boolean;
  /** 调度引擎当前是否活跃（V1 task 9.4；单全局 RoleDispatcher）。 */
  dispatchActive: boolean | null;
}

export interface PanelPublish {
  id: number;
  title: string | null;
  status: string;
  platformPostId: string | null;
  publishedAt: number;
}

/** in-flight 发布队列（orchestrator getStatus）。 */
export interface ContentQueue {
  status: string;
  snapshot: unknown | null;
}
