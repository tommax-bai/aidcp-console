/** 面板 API DTO 类型（与 cloud src/panel 对齐）。 */

import type {
  RiskStatus,
  RiskQuotaLevel,
  RiskAction,
  AlertSeverity,
  LlmKind,
  ModelEffectiveSource,
  PersonaSource,
  ThinkingModeApi,
} from './aidcp-enums';

// 面板角色/模型配置枚举：单源在 aidcp-enums（对 cloud /api/version 对拍防漂移，
// change console-panel-config-enum-fingerprint）；此处复出，既有消费方仍从 '../types/api' 导入。
export type { LlmKind, ModelEffectiveSource, PersonaSource, ThinkingModeApi };

export interface VersionPayload {
  panelApiVersion: number;
  enums: {
    riskStatus: RiskStatus[];
    riskQuotaLevel: RiskQuotaLevel[];
    riskAction: RiskAction[];
    /** V1 task 9.5 落地后补（漂移哨兵）。 */
    alertSeverity: AlertSeverity[];
    /** 文本/图片生成厂商全集（手工镜像 cloud；哨兵对拍，change console-cloud-panel-hardening #5/#6）。 */
    textProvider: string[];
    imageProvider: string[];
    /** 面板角色/模型配置枚举全集（哨兵对拍防漂移，change console-panel-config-enum-fingerprint）。 */
    llmKind: LlmKind[];
    effectiveSource: ModelEffectiveSource[];
    personaSource: PersonaSource[];
    thinkingMode: ThinkingModeApi[];
  };
  /** 关键 DTO 字段指纹（手工镜像 cloud；哨兵对拍防漂移，#6）。 */
  dtoFields: {
    panelAccount: string[];
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
  /** 关联联系方式（change account-group-chat-injection；verbatim，未配为 null）。手工镜像 cloud panel-store.ts。 */
  contactInfo: string | null;
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

/**
 * 容器（群/主页）配置项（change facebook-container-display-name）。手工镜像 cloud FacebookContainer。
 * `url` 是功能主键（含群 id，边缘据此站内搜）；`name` 是真实群名（边缘自动解析回填）。
 * **对人一律展示 name（缺则「待识别」占位），绝不展示 url 里的 id**（id 对人无辨识度）。
 */
export interface FacebookContainer {
  url: string;
  name?: string;
}

/**
 * 每账号 Facebook 定时评论配置（change facebook-scheduled-comment 2.1 + facebook-container-display-name）。
 * 手工镜像 cloud config/facebook-comment-config-store.ts。关键词或容器任一为空 = 不生效（云端 fail-closed）。
 */
export interface FacebookCommentConfig {
  accountId: string;
  /** 搜索关键词列表（随机选一个）。 */
  keywords: string[];
  /** 允许的容器列表（运营方自己的 / 已加入的 Facebook 主页、群）；只在这些容器内部搜索。展示用群名、不用 id。 */
  containers: FacebookContainer[];
  updatedAt: string | null;
  updatedBy: string | null;
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
  /**
   * 当前 day 窗口生效配额上限（每动作，change decouple-quota-hit-from-risk）：随风控态/档位变化
   * （restricted 互动上限为 0）。后端拿不到 controller 时缺省——此时前端只显用量数字、不显上限。
   * 注意：这是**我方节流用量**，非平台风控态，展示上与风控状态徽标区分。
   */
  quotas?: Record<RiskAction, number>;
  /** 今日已撞当日上限（used >= cap）的动作，前端据此把该格标红。 */
  saturated?: RiskAction[];
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

export interface CaptchaAssistViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface CaptchaAssistCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptchaAssistImage {
  mime: 'image/png' | 'image/jpeg';
  data: string;
  width: number;
  height: number;
}

export interface CaptchaAssistSnapshot {
  incidentId: string;
  edgeId?: string;
  accountId?: string;
  snapshotId: string;
  capturedAt: number;
  expiresAt?: number;
  kind: 'captcha' | 'unknown';
  url?: string;
  viewport: CaptchaAssistViewport;
  crop: CaptchaAssistCrop;
  image: CaptchaAssistImage;
  overlay?: {
    kind: 'captcha' | 'unknown';
    firstDetectedUrl?: string;
    capturedAt: number;
    text?: string;
    dom?: { tag: string; text?: string; rect?: CaptchaAssistCrop; matchReasons?: string[] };
    candidates: unknown[];
  };
}

export type CaptchaAssistIncidentStatus =
  | 'detected'
  | 'capture_pending'
  | 'ready'
  | 'click_pending'
  | 'cleared'
  | 'still_blocked'
  | 'failed'
  | 'expired';

export interface CaptchaAssistIncident {
  incidentId: string;
  edgeId: string;
  accountId?: string;
  accountName?: string;
  machineLabel?: string;
  remoteAddr?: string;
  kind: 'captcha' | 'unknown';
  status: CaptchaAssistIncidentStatus;
  riskStatus?: string;
  detectedAt: number;
  updatedAt: number;
  expiresAt: number;
  url?: string;
  snapshot?: CaptchaAssistSnapshot;
  lastResult?: {
    status: 'cleared' | 'still_blocked' | 'stale_snapshot' | 'not_blocked' | 'invalid_target' | 'failed';
    reason?: string;
    checkedAt: number;
    snapshotId?: string;
  };
  lastDispatch?: {
    type: 'capture' | 'click';
    requestedAt: number;
    sent: number;
    actor: string;
  };
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
  /**
   * 内容版本号（change edit-note-draft-before-publish）：0=未编辑，>0=已在控制台改过（原飞书卡片已失效）。
   * 审批时快照此值随授权带回（「审=发」凭证）；待审草稿据此渲染生命周期标签。
   */
  contentVersion: number;
  /**
   * 全部配图 URL（保序，[0]=封面；空数组=无图）。OSS 转存后为公读永久链接可直接 <img>；
   * 更早历史行是生图厂商约 24h 过期的临时签名 URL，前端须容忍死链（fallback 占位）。
   */
  images: string[];
  /** 封面图 URL（= images[0]，向后兼容）；无图为 null。 */
  imageUrl: string | null;
  /** 边端实际附着上传成功的图片张数（诚实信号：区分「生成了几张」与「真上传了几张」）。 */
  imagesAttachedCount: number;
  /** 参照洗稿参考图是否真实被图片 provider 使用的审计；普通发布/历史行为 null。 */
  imageReferenceAudit: PanelImageReferenceAudit | null;
  /** 参照洗稿来稿快照；普通发布为 null。 */
  sourceReference: PanelPublishSourceReference | null;
}

export type PanelImageReferenceAuditStatus = 'none' | 'used' | 'unsupported' | 'unavailable' | 'skipped';

export interface PanelImageReferenceAudit {
  requestedCount: number;
  usableCount: number;
  status: PanelImageReferenceAuditStatus;
  providerClaimedUsed: boolean;
  generatedCount: number;
}

export interface PanelPublishSourceReference {
  kind: 'curated_reference';
  curatedContentId: number | null;
  accountId: string;
  sourceId: string;
  title: string | null;
  body: string | null;
  author: string | null;
  topics: string[];
  sourceUrl: string | null;
  capturedAt: number;
}

/**
 * 生成中单轮摘要（change parallel-rewrite-drafts：并行多轮观测）。与 cloud publish-orchestrator RunSummary 镜像。
 * kind：rewrite=参照洗稿轮（sourceId 为锚定参照稿）；autonomous=自主创作轮。
 */
export interface ContentQueueRun {
  runId: string;
  accountId: string;
  kind: 'rewrite' | 'autonomous';
  sourceId: string | null;
  startedAt: number;
  status: string;
  snapshot: unknown | null;
}

/**
 * in-flight 发布队列（orchestrator getStatus，change parallel-rewrite-drafts 兼容形状）。
 * 旧字段 status/snapshot=聚合视图（最新启动的 running 轮，无 running 则最近终态）；runs=全部在跑轮。
 * runs 可空缺（旧 cloud 未升级时）——渲染必须优雅回落旧单快照，绝不因缺字段白屏。
 */
export interface ContentQueue {
  status: string;
  snapshot: unknown | null;
  runs?: ContentQueueRun[];
}

// ── 精选内容后台管理（change curated-content-admin-page）────────────────────────
// ⚠ 与 cloud `src/cache/curated-content-store.ts` 的 CuratedPanelRow/CuratedPanelListResult/CuratedFacets
//   手工镜像，两处须同步防漂移。诚实置空：计数 null=未抓到（区别真实 0）；时间戳为 epoch ms（number）。
export type CuratedContentType = 'image_text' | 'video' | 'comment';

export type CuratedReferenceImageStatus = 'stored' | 'url_only' | 'fetch_failed' | 'unsupported';

export interface CuratedReferenceImage {
  index: number;
  sourceUrl: string;
  ossUrl?: string;
  width?: number;
  height?: number;
  alt?: string;
  captureStatus: CuratedReferenceImageStatus;
  capturedAt: number;
}

export interface PanelCuratedContent {
  id: number;
  accountId: string;
  contentType: CuratedContentType;
  sourceId: string;
  title: string | null;
  body: string | null;
  author: string | null;
  sourceUrl: string | null;
  topics: string[];
  likeCount: number | null;
  collectCount: number | null;
  commentCount: number | null;
  countsCapturedAt: number | null;
  botLiked: boolean;
  botCollected: boolean;
  admitReason: string | null;
  firstSeenAt: number;
  updatedAt: number;
  referenceImages: CuratedReferenceImage[];
}

export interface CuratedContentList {
  items: PanelCuratedContent[];
  total: number;
}

export interface CuratedFacets {
  admitReasons: { admitReason: string | null; count: number; botActionCount: number }[];
  imageTextCount: number;
  videoCount: number;
  /** 兼容旧云端 / 旧面板字段；新语义为图文+视频。 */
  noteCount: number;
  commentCount: number;
}

/**
 * 精选笔记行级动作触发态回执（change curated-note-actions）。
 * ⚠ 与 cloud `src/panel/types.ts` 的 CuratedActionReceipt 手工镜像。
 * 触发态≠成功态：triggered=false 时 reason 为机器原因码（页内映射中文），绝不当成功渲染。
 */
export interface CuratedActionReceipt {
  triggered: boolean;
  reason?: string;
}

/** 单厂商凭据视图（change console-model-provider-config + model-config-volcengine-provider）。永不含明文密钥。 */
export interface ModelConfigCredential {
  provider: string;
  field: string;
  label: string;
  providerLabel: string;
  group: 'model_api' | 'billing_access';
  groupLabel: string;
  secretKind: 'api_key' | 'access_key_id' | 'access_key_secret';
  restartRequired: boolean;
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

/** 可选图片厂商项（手工镜像 cloud ImageProviderView，change console-cloud-panel-hardening #5）。 */
export interface ImageProviderOption {
  id: string;
  displayName: string;
}

/** GET /api/config/model 形状（change model-config-volcengine-provider：多厂商）。 */
export interface ModelConfig {
  /** 选中的全局文本厂商。 */
  textProvider: string;
  /** 选中的全局图片厂商（change console-cloud-panel-hardening #5：不再钉死 dashscope，读 cloud 真实配置）。 */
  imageProvider: string;
  textModel: string;
  imageModel: string;
  /** 可选文本厂商列表。 */
  providers: TextProviderOption[];
  /** 可选图片厂商列表（#5：设置页图片厂商下拉数据源；手工镜像 cloud）。 */
  imageProviders: ImageProviderOption[];
  /** 平台凭据状态（模型 API key / 账单 AccessKey 等）。 */
  credentials: ModelConfigCredential[];
  /** 主加密密钥是否就位——凭据能否在后台编辑。 */
  canEditCredential: boolean;
}

// 角色级模型/温度配置（change console-role-model-config）。与 cloud RoleConfigRowView 手动对齐。

// ModelEffectiveSource / ThinkingModeApi 已上移 aidcp-enums 单源（见文件头 import + 复出）。

/** 单角色目录行 + 生效值（GET /api/roles 形状）。 */
export interface RoleConfigRow {
  roleId: string;
  displayName: string;
  group: 'browse' | 'publish';
  /** 所属分类（稳定 key，与 category_config.category_id 一致）。 */
  category: string;
  /** text=可配模型/温度；image=全局配置不在此覆盖；vision=视觉角色（模型经 env 解析，只读）；none=不调模型。 */
  llmKind: LlmKind;
  /** 是否开放温度调节（仅生成/改写类）。 */
  tunableTemperature: boolean;
  /** 当前生效模型（文本类=覆盖/分类默认/全局；图像类=全局图片模型）。 */
  effectiveModel: string;
  /** 当前生效厂商（change model-config-volcengine-provider）：取自贡献生效模型那一层；图像类恒 dashscope。 */
  effectiveProvider: string;
  /** 生效模型来源：override=按角色覆盖 / category=继承分类默认 / default=继承全局默认 / image=图像全局 / vision=视觉全局。 */
  effectiveSource: ModelEffectiveSource;
  /** 是否存在按角色模型覆盖。 */
  modelOverridden: boolean;
  /** 温度覆盖（null=用代码默认）。 */
  temperatureOverride: number | null;
  /** 当前生效思考模式（change role-thinking-mode-config）：role→分类→default 回落后的三态。 */
  effectiveThinkingMode: ThinkingModeApi;
  /** 按角色思考模式覆盖（null=未覆盖）。 */
  thinkingModeOverride: 'off' | 'on' | null;
  /** 生效思考模式来源。 */
  thinkingModeSource: 'override' | 'category' | 'default';
  /** 生效模型是否支持"开启(on)"：false 表示需流式（如 DashScope Qwen）本期不支持，前端禁用"开启"。 */
  thinkingOnAvailable: boolean;
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
  /** 分类默认思考模式（change role-thinking-mode-config）：覆盖则用覆盖、否则 default。 */
  effectiveThinkingMode: ThinkingModeApi;
  /** 是否存在分类思考模式覆盖。 */
  thinkingModeOverridden: boolean;
  /** 该分类默认模型是否支持"开启(on)"（false 前端禁用开启）。 */
  thinkingOnAvailable: boolean;
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
  /**
   * 选定账号未绑定人设的诚实标志（prompt-preview-persona-selector / persona-driven-content-pipeline，可选）：
   * true=该账号运行会被拒，下示 prompt 为示例人设渲染、仅供查看（绝不冒充该账号人设）。
   */
  personaFallback?: boolean;
  /** 本次预览的人设来源（可选，旧后端不返回时前端回退推断）。 */
  personaSource?: 'sample' | 'account' | 'fallback_sample' | 'none';
  /** 面向操作员的人设来源短标签。 */
  personaSourceLabel?: string;
}

// 账号人设配置（change account-persona-config，stream F）。与 cloud PersonaConfigRowView 手动对齐。

// PersonaSource（override=已绑定 / none=未绑定；系统无默认/兜底人设）已上移 aidcp-enums 单源（见文件头 import + 复出）。

/** 单账号人设目录行（GET /api/persona 形状）。列出所有账号（含未绑定者）。 */
export interface PersonaConfigRow {
  accountId: string;
  label: string | null;
  source: PersonaSource;
  /** 当前生效人设的身份摘要（解析结果），列表一眼识别「这是谁」；未绑定（none）为空串。 */
  identityName: string;
  identityRole: string;
  /** 仅 override 行带审计；none 行为 null。 */
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
  /** 编辑器内容：override→该账号人设文本；none→打包模板原文仅作「起点模板」（非运行时兜底）。 */
  persona: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

// 安全限额配置（change safety-quota-config，stream D）。与 cloud QuotaConfigRowView 手动对齐。

/** 限额档位（三档）。 */
export type QuotaTier = 'conservative' | 'normal' | 'aggressive';
/** 受限动作（与 cloud RISK_ACTIONS 一致）。 */
export type QuotaAction = 'view' | 'like' | 'collect' | 'comment' | 'follow' | 'publish' | 'comment_like' | 'join_group';

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

export type FacebookGroupJoinGating = 'unknown' | 'instant' | 'gated';
export type FacebookGroupMembershipStatus =
  | 'assigned'
  | 'joining'
  | 'joined'
  | 'pending'
  | 'gated'
  | 'no_button'
  | 'checkpoint'
  | 'failed'
  | 'left';

export interface FacebookGroupTargetRow {
  groupUrl: string;
  groupName: string | null;
  joinGating: FacebookGroupJoinGating;
  priority: number;
  enabled: boolean;
  importBatch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FacebookGroupTargetListRow extends FacebookGroupTargetRow {
  accountId: string | null;
  membershipStatus: FacebookGroupMembershipStatus | null;
  joinedAt: string | null;
  lastAttemptAt: string | null;
  lastReason: string | null;
  lastCommentedAt: string | null;
  commentsTotal: number;
}

export interface FacebookGroupTargetList {
  items: FacebookGroupTargetListRow[];
  total: number;
}

export interface FacebookGroupImportResult {
  imported: number;
  duplicate: number;
  invalid: number;
  rows: FacebookGroupTargetRow[];
}

export interface FacebookGroupAccountProgress {
  accountId: string;
  assigned: number;
  joining: number;
  joined: number;
  pending: number;
  gated: number;
  failed: number;
  lastJoinedAt: string | null;
  lastCommentedAt: string | null;
}

export interface FacebookGroupMembershipRow {
  accountId: string;
  groupUrl: string;
  status: FacebookGroupMembershipStatus;
  assignedAt: string | null;
  joinedAt: string | null;
  lastAttemptAt: string | null;
  attempts: number;
  lastReason: string | null;
  lastCommentedAt: string | null;
  cooldownUntil: string | null;
  commentsTotal: number;
  leftConfirmations: number;
  updatedAt: string;
}

// 单场会话上限配置（全局单例，change restore-auto-resume-and-global-safety-config）。与 cloud SessionLimitView 手动对齐。

/** 单场互动预算（七项，与 cloud SessionInteractionBudget 一致）。 */
export interface SessionInteractionBudget {
  likes: number;
  collects: number;
  follows: number;
  searches: number;
  comments: number;
  comment_likes: number;
  join_groups: number;
}

/** 全局单场上限生效值 + 来源/审计（GET /api/session-limits 形状）。对所有账号生效。 */
export interface SessionLimitView {
  maxDurationMin: number;
  budget: SessionInteractionBudget;
  /** 收藏质量闸：收藏:赞 比例的分母 N（即 1:N；默认 3）。 */
  collectSaveLikeDenom: number;
  /** 关注质量闸：粉丝:赞藏 比例的分母 N（即 1:N；默认 8）。 */
  followFansDenom: number;
  /** 「可活跃时间」周历掩码（168 格 '0'/'1'，周一起头×24h；按服务器本地时间）。null = 未配置 / 全天活跃。 */
  activeWeekMask: string | null;
  /** 是否存在库内覆盖（false=显示的是写死默认，即当前真生效）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// 内容热度过滤阈值（全局单例，change feed-hot-lead-group-comment）。与 cloud 手动对齐。
// 判定「涨得快的热帖线索」的三道客观闸；对所有账号生效，热加载即时生效。速率阈值与账号限频物理隔离。

/** 全局内容热度过滤阈值生效值 + 来源/审计（GET/PUT /api/hot-lead-config 形状）。三项均为正整数。 */
export interface HotLeadConfigView {
  /** 帖龄上限（小时）：超过此时长的帖不再算「涨得快」（建议 24–48）。 */
  postAgeMaxHours: number;
  /** 每小时点赞阈值：达到此每小时点赞速率才算热帖。 */
  velocityMin: number;
  /** 最小点赞数：绝对点赞低于此不算，挡小基数假热。 */
  minLikeFloor: number;
  /** 是否存在库内覆盖（false=显示的是内置写死默认，即当前真生效）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// 节奏兜底配置（change pacing-floor-config-min-interval）。与 cloud PacingConfigRowView 手动对齐，两处须同步防漂移。
// 语义=「最小间隔」兜底：每类操作两次动作之间的下限区间（毫秒）。生效值已含读出口夹逼护栏（≥ 非零防呆下限、≤ 类别上限），
// 故 minMs 恒非零——配置只能抬高延迟、抬不穿下限（绝不零延迟红线不可经配置绕过）。

/** 兜底操作类别（与 cloud PacingOp / edge 逐字一致）。 */
export type PacingOperation =
  | 'action'
  | 'scroll'
  | 'card_gap'
  | 'detail_dwell'
  | 'feed_card_read'
  | 'content_glance'
  | 'content_read';

/** 单 op 兜底区间生效值（已含夹逼护栏）+ 来源/审计（GET /api/pacing 行）。 */
export interface PacingConfigRow {
  operation: PacingOperation;
  /** 生效最小间隔（毫秒，读出口 clamp 后 ≥ 非零防呆下限）。 */
  minMs: number;
  /** 生效最大间隔（毫秒，≤ 类别上限）。 */
  maxMs: number;
  /** 是否存在库内覆盖（false=显示的是内置写死默认，即当前真生效）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET/PUT /api/pacing 形状（每 op 一行的目录）。 */
export interface PacingConfigView {
  pacing: PacingConfigRow[];
}

// 自动续场护栏 + 看门狗阈值配置（全局单例，change restore-auto-resume-and-global-safety-config）。与 cloud ResumeConfigView 手动对齐。

/** 全局续场护栏 + 看门狗阈值生效值 + 来源/审计（GET /api/resume-config 形状）。对所有账号生效。 */
export interface ResumeConfigView {
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

// ── token 用量统计（change llm-token-usage-stats，GET /api/llm-usage 形状，与 cloud 逐字对齐）──

/** 表格一行：按北京日期 × (账号/角色/模型) 聚合。token 量为数值（BIGINT 求和后解析）。 */
export interface LlmUsageCostEstimate {
  amount: number;
  currency: string;
  source: string;
  sourceDate: string;
  syncedAtMs: number | null;
  pricingBasis: 'input_output_tokens' | 'total_tokens';
}

export interface LlmUsageRow {
  /** 'YYYY-MM-DD'（Asia/Shanghai 北京日）。 */
  day: string;
  accountId: string;
  role: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  okCalls: number;
  costEstimate: LlmUsageCostEstimate | null;
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

export interface LlmBillingPriceRefreshPayload {
  ok: true;
  checkedDays: string[];
  targetCount: number;
  written: number;
  prices: Array<{
    provider: string;
    model: string;
    usageDay: string;
    currency: string;
    pricingBasis: 'input_output_tokens' | 'total_tokens';
    source: string;
    sourcePeriod: string | null;
  }>;
  skipped: Array<{
    provider: string;
    model: string;
    usageDay: string;
    reason:
      | 'missing_credentials'
      | 'unsupported_provider'
      | 'no_local_usage'
      | 'no_billing_sample'
      | 'billing_api_error';
  }>;
  missingCredentials: string[];
}

/**
 * 通知联系人（change notification-contact-registry）。给本账号发过通知的人（评论/@/点赞/收藏/关注）。
 * 时间戳为 epoch ms。手工镜像 cloud NotificationContact，两处须同步防漂移。
 */
export interface PanelNotificationContact {
  /** 该联系人归属账号（全账号视图下区分同一人在不同账号下的两行 + 路由人工字段写入）。手工镜像 cloud。 */
  accountId: string;
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

// ── 团队 → 飞书群路由（change feishu-per-team-notification-routing）。手工镜像 cloud DTO，两处须同步防漂移。 ──

/** 一条团队路由：账号 group_label → 目标飞书群 chat_id（opaque，非枚举 → 结构性避免枚举漂移白屏）。 */
export interface PanelGroupRoute {
  groupLabel: string;
  chatId: string;
  updatedBy: string | null;
  updatedAt: number;
}

/** 机器人当前所在的一个群（供路由目标下拉；杜绝手贴 raw chat_id）。 */
export interface PanelBotChat {
  chatId: string;
  /** 真实群名（change feishu-bot-chat-name-display，来自飞书 im/v1/chats）；取不到 → null，前端回落显示 chatId。 */
  name: string | null;
  isDefault: boolean;
}

/** GET /api/bot-chats 响应（change feishu-bot-chat-name-display）。 */
export interface PanelBotChatsResponse {
  chats: PanelBotChat[];
  /** 未映射账号的兜底默认群 chatId；无则 null。 */
  defaultChatId: string | null;
  /** 群名来源：`feishu`=实时真实群名；`store`=飞书取名失败降级回 bot_chats 表（群名可能空、需补 im:chat:readonly 权限）。 */
  source: 'feishu' | 'store';
}

// ── 内容排期（change content-schedule-auto-publish，Phase 1 只做发帖）。手工镜像 cloud DTO，两处须同步防漂移。 ──

/**
 * 全局「内容可自动时段」周历格（GET/PUT /api/content-schedule/global）。
 * 与浏览掩码（SessionLimitView.activeWeekMask）物理分开、语义不同：本格治「何时允许自动发帖」。
 * 语义 fail-closed：null / 非法 = 全 0 = 不自动（与浏览掩码 null=全天活跃刻意相反）。
 */
export interface ContentScheduleGlobalView {
  contentActiveMask: string | null;
  /** 是否存在库内覆盖（false=未配=全 0=不自动）。 */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * 每账号内容排期一行（GET /api/content-schedule）。Phase 1 只暴露发帖字段。
 * 时段来源 maskSource：'override'=该账号自定义时段（v1 无编辑入口，仅回显）、'global'=继承全局内容格。
 */
export interface ContentScheduleRow {
  accountId: string;
  label: string | null;
  nickname: string | null;
  /** 总开关：false=该账号完全不自动（零回归默认）。 */
  autoEnabled: boolean;
  /** 发帖开关。 */
  postEnabled: boolean;
  /** 发帖日上限；0=该动作不自动（与开关双保险）。 */
  postDailyCap: number;
  /** 自动评论开关（change content-schedule-comments）。 */
  commentEnabled: boolean;
  /** 评论日上限；0=不自动。该时段「尝试」评论：自行搜索目标、可能 0 产出、每条需飞书人审。 */
  commentDailyCap: number;
  /** 自动联系评论开关（change content-schedule-group-comments；开启须过一码一号硬校验）。 */
  contactCommentEnabled: boolean;
  /** 联系评论每日自动尝试上限（硬 ≤10、建议 ≤3；被拒/无目标也占额度）。 */
  contactCommentDailyCap: number;
  /** 该账号是否已配联系方式（联系评论开关前置徽标）。 */
  hasContactInfo: boolean;
  maskSource: 'override' | 'global';
  hasOverrideMask: boolean;
  /** 侧表有行（false=纯默认=未配）。 */
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/content-schedule 形状。 */
export interface ContentScheduleCatalog {
  rows: ContentScheduleRow[];
}

/** PUT /api/content-schedule/:accountId 请求体（部分字段；服务端整块校验、非法拒不部分落库）。 */
export interface ContentSchedulePatch {
  autoEnabled?: boolean;
  postEnabled?: boolean;
  postDailyCap?: number;
  commentEnabled?: boolean;
  commentDailyCap?: number;
  contactCommentEnabled?: boolean;
  contactCommentDailyCap?: number;
  /** 每账号时段覆盖：168 位 '0'/'1'，或 null=清空覆盖=继承全局。v1 前端不写此字段（留缝）。 */
  contentActiveMask?: string | null;
}
