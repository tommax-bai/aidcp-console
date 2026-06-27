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
  /** 登录账号平台真实昵称（change account-real-nickname；未采到为 null，回落 label/accountId）。手工镜像 cloud。 */
  nickname: string | null;
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

/**
 * 互动流一行（change interaction-feed-enrichment）。
 * 四类动作；目标 = 笔记动作 noteId / 关注 authorId；title=笔记标题或作者昵称、url=详情页/主页链接，
 * 均诚实置空（缺失为 undefined，前端回落裸 id、绝不渲染死链）。
 */
export interface PanelInteraction {
  accountId: string;
  targetId: string;
  action: 'like' | 'collect' | 'comment' | 'follow';
  title?: string;
  url?: string;
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

/** 单厂商凭据视图（change console-model-provider-config + model-config-volcengine-provider）。永不含明文密钥。 */
export interface ModelConfigCredential {
  provider: string;
  field: string;
  configured: boolean;
  maskedHint: string | null;
  /** db=库内加密凭据 / env=回退环境变量 / none=未配置。 */
  source: 'db' | 'env' | 'none';
}

/** 可选文本厂商（下拉项 + 只读 baseUrl）。 */
export interface TextProviderOption {
  id: string;
  displayName: string;
  baseUrl: string;
}

/** GET /api/config/model 形状（change model-config-volcengine-provider：多厂商）。 */
export interface ModelConfig {
  /** 选中的全局文本厂商。 */
  textProvider: string;
  /** 图片厂商钉死 dashscope（图片不动）。 */
  imageProvider: 'dashscope';
  textModel: string;
  imageModel: string;
  /** 可选文本厂商列表。 */
  providers: TextProviderOption[];
  /** 各厂商凭据状态。 */
  credentials: ModelConfigCredential[];
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
  /** 当前生效厂商（change model-config-volcengine-provider）：取自贡献生效模型那一层；图像类恒 dashscope。 */
  effectiveProvider: string;
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
  /** 分类默认模型的生效厂商（change model-config-volcengine-provider）：覆盖则用同行、否则回落全局文本厂商。 */
  effectiveProvider: string;
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
  /** 本次预览所用账号（change prompt-preview-persona-selector，可选）：选了账号才回显；不选则不附。 */
  accountId?: string;
  /** 选定账号未配人设、回落默认人设的诚实标志（change prompt-preview-persona-selector，可选）：true=下示为默认人设。 */
  personaFallback?: boolean;
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

// 单场会话上限配置（change session-limits-to-quota-layer）。与 cloud SessionLimitRowView 手动对齐。

/** 单场互动预算（六项，与 cloud SessionInteractionBudget 一致）。 */
export interface SessionInteractionBudget {
  likes: number;
  collects: number;
  follows: number;
  searches: number;
  comments: number;
  comment_likes: number;
}

/** 单账号单场上限生效值 + 来源/审计（GET /api/session-limits 形状）。 */
export interface SessionLimitRow {
  accountId: string;
  maxDurationMin: number;
  budget: SessionInteractionBudget;
  /** 是否存在库内覆盖（false=显示的是写死默认，即当前真生效）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/session-limits 形状。 */
export interface SessionLimitCatalog {
  limits: SessionLimitRow[];
}

// 自动续场护栏 + 看门狗阈值配置（change session-auto-resume-with-excursions）。与 cloud ResumeConfigRowView 手动对齐。

/** 单账号续场护栏 + 看门狗阈值生效值 + 来源/审计（GET /api/resume-config 形状）。 */
export interface ResumeConfigRow {
  accountId: string;
  /** 休息比例（百分比，如 10 = 单场时长的 10%）。 */
  restRatioPct: number;
  /** 活跃时段窗口起/止（自午夜分钟数，0..1440；0..1440 = 全天不限）。 */
  activeWindowStartMin: number;
  activeWindowEndMin: number;
  /** 每日自动续场上限（场数 / 累计分钟）；0 = 不限。 */
  dailyMaxSessions: number;
  dailyMaxMinutes: number;
  /** 看门狗两段阈值（毫秒）：恢复轻推 / 放弃结束。 */
  idleNudgeMs: number;
  idleEndMs: number;
  /** 是否存在库内覆盖（false=显示的是写死默认）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/resume-config 形状。 */
export interface ResumeConfigCatalog {
  configs: ResumeConfigRow[];
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

/**
 * 通知联系人（change notification-contact-registry）。给本账号发过通知的人（评论/@/点赞/收藏/关注）。
 * 时间戳为 epoch ms。手工镜像 cloud NotificationContact，两处须同步防漂移。
 */
export interface PanelNotificationContact {
  senderKey: string;
  nickname: string | null;
  userId: string | null;
  firstReason: string;
  reasons: string[];
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  wechat: string | null;
  note: string | null;
  tags: string[];
  updatedBy: string | null;
  updatedAt: number | null;
}
