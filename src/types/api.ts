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
  /** 人设绑定状态（派生，multi-account-node-support）：以 persona_config 行存在且非空为准。 */
  personaBound: boolean;
  /** 需设置人设（派生）：未绑且非 default。手工镜像 cloud panel-store.ts PanelAccount，两处须同步防漂移。 */
  needsPersonaSetup: boolean;
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
  /** 发布账号（change publish-history-account-and-detail）。 */
  accountId: string;
  /** 账号展示名（label ?? account_id）。 */
  accountLabel: string;
  /** 已发布正文全文（「查看」展示）。 */
  content: string | null;
  /** 小红书详情页分享 URL（带 xsec_token）；为 null 时后台显示「无链接」、不给坏链。 */
  postUrl: string | null;
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

/** prompt 来源分段（change prompt-viewer-persona-source）：role=角色独有指令 / persona=来自账号人设。 */
export interface RolePromptSegment {
  source: 'role' | 'persona';
  text: string;
}

/** 角色 prompt 只读预览（change role-prompt-visibility）。GET /api/roles/:roleId/prompt 形状。 */
export interface RolePromptView {
  roleId: string;
  /** 忠实渲染的 prompt（示例数据 + 真实人设）；不可预览时为 null。 */
  prompt: string | null;
  available: boolean;
  /** 占位说明 / 不可预览原因。 */
  note: string;
  /** 人设来源分段（change prompt-viewer-persona-source，可选）：有则按段渲染、persona 段加底色；无则回落扁平。 */
  segments?: RolePromptSegment[];
}

// 账号人设配置（change account-persona-config，stream F）。与 cloud PersonaConfigRowView 手动对齐。

/** 人设来源：override=该账号自定义人设 / fallback=回落打包默认人设。 */
export type PersonaSource = 'override' | 'fallback';

/** 单账号人设目录行（GET /api/persona 形状）。列出所有账号（含回落者）。 */
export interface PersonaConfigRow {
  accountId: string;
  label: string | null;
  source: PersonaSource;
  /** 当前生效人设的身份摘要（解析结果），列表一眼识别「这是谁」。 */
  identityName: string;
  identityRole: string;
  /** 仅 override 行带审计；fallback 行为 null。 */
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/persona 形状。 */
export interface PersonaConfigCatalog {
  accounts: PersonaConfigRow[];
}

/** 单账号人设详情（GET /api/persona/:accountId，编辑回显）。 */
export interface PersonaDetailView {
  accountId: string;
  label: string | null;
  source: PersonaSource;
  /** 编辑器内容：override→该账号人设文本；fallback→打包默认人设原文（编辑起点）。 */
  persona: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

// 安全限额配置（change safety-quota-config，stream D）。与 cloud QuotaConfigRowView 手动对齐。

/** 限额档位（三档）。 */
export type QuotaTier = 'conservative' | 'normal' | 'aggressive';
/** 受限动作（与 cloud RISK_ACTIONS 一致）。 */
export type QuotaAction = 'view' | 'like' | 'collect' | 'comment' | 'follow' | 'publish' | 'comment_like';

/** 单 (tier,action) 三窗口生效数字 + 来源/审计（GET /api/quotas 形状）。 */
export interface QuotaConfigRow {
  tier: QuotaTier;
  action: QuotaAction;
  daily: number;
  perMinute: number;
  perHour: number;
  /** 是否存在库内覆盖（false=显示的是派生写死默认，即当前真生效）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/quotas 形状。 */
export interface QuotaConfigCatalog {
  quotas: QuotaConfigRow[];
}

// ── token 用量统计（change llm-token-usage-stats，GET /api/llm-usage 形状，与 cloud 逐字对齐）──

/** 表格一行：按北京日期 × (账号/角色/模型) 聚合。token 量为数值（BIGINT 求和后解析）。 */
export interface LlmUsageRow {
  /** 'YYYY-MM-DD'（Asia/Shanghai 北京日）。 */
  day: string;
  accountId: string;
  role: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  okCalls: number;
}

/** 曲线一点：10 分钟桶。bucketMs 为 UTC epoch ms（前端按 Asia/Shanghai 渲染）。 */
export interface LlmUsageBucket {
  bucketMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

/** GET /api/llm-usage 形状。window 回报真实生效时间窗（含超限 clamp 标记）。 */
export interface LlmUsagePayload {
  rows: LlmUsageRow[];
  buckets: LlmUsageBucket[];
  window: { fromMs: number; toMs: number; clampedToDays: number | null };
}
