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

/** 模型凭据视图（change console-model-provider-config）。永不含明文密钥。 */
export interface ModelConfigCredential {
  field: string;
  configured: boolean;
  maskedHint: string | null;
  /** db=库内加密凭据 / env=回退环境变量 / none=未配置。 */
  source: 'db' | 'env' | 'none';
}

/** GET /api/config/model 形状。 */
export interface ModelConfig {
  provider: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  credential: ModelConfigCredential;
  /** 主加密密钥是否就位——凭据能否在后台编辑。 */
  canEditCredential: boolean;
}

// 角色级模型/温度配置（change console-role-model-config）。与 cloud RoleConfigRowView 手动对齐。

/** 生效模型来源（change role-model-category-config）：覆盖 / 继承分类 / 继承默认 / 图像全局。 */
export type ModelEffectiveSource = 'override' | 'category' | 'default' | 'image';

/** 单角色目录行 + 生效值（GET /api/roles 形状）。 */
export interface RoleConfigRow {
  roleId: string;
  displayName: string;
  group: 'browse' | 'publish';
  /** 所属分类（稳定 key，与 category_config.category_id 一致）。 */
  category: string;
  /** text=可配模型/温度；image=全局配置不在此覆盖；none=不调模型。 */
  llmKind: 'text' | 'image' | 'none';
  /** 是否开放温度调节（仅生成/改写类）。 */
  tunableTemperature: boolean;
  /** 当前生效模型（文本类=覆盖/分类默认/全局；图像类=全局图片模型）。 */
  effectiveModel: string;
  /** 生效模型来源：override=按角色覆盖 / category=继承分类默认 / default=继承全局默认 / image=图像全局。 */
  effectiveSource: ModelEffectiveSource;
  /** 是否存在按角色模型覆盖。 */
  modelOverridden: boolean;
  /** 温度覆盖（null=用代码默认）。 */
  temperatureOverride: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/roles 形状。 */
export interface RoleConfigCatalog {
  roles: RoleConfigRow[];
}

// 分类级模型默认（change role-model-category-config，item 5/6）。与 cloud CategoryConfigRowView 手动对齐。

/** 单分类目录行 + 分类默认生效值（GET /api/categories 形状）。 */
export interface CategoryConfigRow {
  categoryId: string;
  displayName: string;
  order: number;
  /** 分类默认模型生效值（分类覆盖则用覆盖，否则回落全局「默认模型」）。 */
  effectiveModel: string;
  /** 是否存在分类默认覆盖（false=继承全局默认模型）。 */
  modelOverridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/categories 形状。 */
export interface CategoryConfigCatalog {
  categories: CategoryConfigRow[];
}
