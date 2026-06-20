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

/**
 * Dashboard 汇总。task 1 仅 edgesOnline 骨架；totals/ratios/accounts/alerts 待 task 5。
 * 按账号切片在归因落地前由 `attributionPending` 驱动「all accounts / attribution pending」标注。
 */
export interface DashboardSummary {
  asOf: number;
  edgesOnline: number;
  partial?: boolean;
  attributionPending?: boolean;
}
