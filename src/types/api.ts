/** 面板 API DTO 类型（与 cloud src/panel 对齐）。 */

import type { RiskStatus, RiskQuotaLevel, RiskAction } from './aidcp-enums';

export interface VersionPayload {
  panelApiVersion: number;
  enums: {
    riskStatus: RiskStatus[];
    riskQuotaLevel: RiskQuotaLevel[];
    riskAction: RiskAction[];
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

export interface DashboardSummary {
  asOf: number;
  edgesOnline: number;
  totals: TodayTotals;
  likeRate: LikeRate;
  accounts: PanelAccount[];
  alerts: unknown[];
  /** 归因未落地：totals/likeRate 为全局，按账号切片须标「attribution pending」。 */
  attributionPending: boolean;
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
