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
export type AccountDisplayNameSource = 'operator_alias' | 'platform_nickname' | 'label' | 'account_id';

export interface PanelAccount {
  accountId: string;
  label: string | null;
  /** 登录账号平台真实昵称（change account-real-nickname；未采到为 null，回落 label/accountId）。手工镜像 cloud。 */
  nickname: string | null;
  operatorAlias: string | null;
  displayName: string;
  displayNameSource: AccountDisplayNameSource;
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
  /** 环境是独立可删除资产；账号只展示当前生命周期摘要。滚动升级旧 Cloud 可能暂缺。 */
  environmentSummary?: { activeCount: number; deletingCount: number; onlineCount: number };
}

/** Legacy 容器配置项，保留用于兼容旧接口 / 回滚；当前 FB 配置 UI 不再编辑它。 */
export interface FacebookContainer {
  url: string;
  name?: string;
}

export type FacebookCommentMode = 'generated' | 'template';

/**
 * 每账号 Facebook 定时评论配置。手工镜像 cloud config/facebook-comment-config-store.ts。
 */
export interface FacebookCommentConfig {
  accountId: string;
  /** 搜索关键词列表（随机选一个）。 */
  keywords: string[];
  /** Legacy 允许容器列表；当前运行时从账号已加入群组账本选群。 */
  containers: FacebookContainer[];
  /** 评论正文来源。 */
  commentMode: FacebookCommentMode;
  /** 模板评论模式下可选模板列表。 */
  commentTemplates: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export type FacebookPublishMediaStatus =
  | 'available'
  | 'reserved'
  | 'used'
  | 'disabled'
  | 'deleted'
  | 'quarantine';

export interface FacebookPublishMediaImage {
  id: number;
  setId: number;
  url: string;
  objectKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  sortOrder: number;
  duplicateOfImageId: number | null;
  createdAt: string;
}

export interface FacebookPublishMediaSet {
  id: number;
  accountId: string;
  status: FacebookPublishMediaStatus;
  captionHint: string | null;
  sortOrder: number;
  reservedBy: string | null;
  reservedAt: string | null;
  usedByPublishLogId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  images: FacebookPublishMediaImage[];
}

export interface FacebookPublishMediaList {
  accountId: string;
  sets: FacebookPublishMediaSet[];
  statusCounts: Record<FacebookPublishMediaStatus, number>;
}

export type FacebookPublishUploadResult =
  | { ok: true; filename: string; set: FacebookPublishMediaSet; duplicate: boolean }
  | { ok: false; filename: string; reason: string; message?: string };

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

/** 键入取证（change captcha-assist-text-answer）；手抄镜像 cloud CaptchaAssistTypeReportPayload，**绝不含答案本身**。 */
export interface CaptchaAssistTypeReport {
  focus: 'editable' | 'opaque' | 'none';
  focusTag?: string;
  cleared?: 'verified' | 'attempted';
  typed: number;
  verified?: 'match' | 'mismatch' | 'unverifiable';
  submitted: boolean;
}

export interface CaptchaAssistIncident {
  incidentId: string;
  edgeId: string;
  accountId?: string;
  accountName?: string;
  machineLabel?: string;
  kind: 'captcha' | 'unknown';
  status: CaptchaAssistIncidentStatus;
  riskStatus?: string;
  detectedAt: number;
  updatedAt: number;
  expiresAt: number;
  url?: string;
  snapshot?: CaptchaAssistSnapshot;
  lastResult?: {
    // change captcha-assist-text-answer：+= no_target（点空了，与坐标越界 invalid_target 区分）。
    status: 'cleared' | 'still_blocked' | 'stale_snapshot' | 'not_blocked' | 'invalid_target' | 'no_target' | 'failed';
    reason?: string;
    checkedAt: number;
    snapshotId?: string;
    /** 本次回执的输入模式：'click' 纯点击 / 'click_type' 含键入。 */
    inputMode?: 'click' | 'click_type';
    /** 键入取证；渲染成人话，绝不含答案。 */
    typeReport?: CaptchaAssistTypeReport;
    /** 版本偏斜：下发了 text 但边缘只点击了（客户端太旧、键入未执行）。 */
    textNotExecuted?: boolean;
  };
  lastDispatch?: {
    type: 'capture' | 'click';
    requestedAt: number;
    sent: number;
    actor: string;
    /** 本次下发的答案字符数（change captcha-assist-text-answer）：只记多少个，never what。 */
    textLen?: number;
  };
  /** 实时抓帧窗口截止（change captcha-assist-live-snapshot）：`Date.now() < liveUntil` 视为实时中，用于亮「实时」指示。 */
  liveUntil?: number;
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
  platform: string;
  platformPostId: string | null;
  publishedAt: number;
  publishMode: 'immediate' | 'draft' | 'scheduled';
  publishTime: number | null;
  scheduledAt: number | null;
  scheduledPlatformId: string | null;
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
  /** 逐槽参考绑定、生成路由和产后视觉核验；历史负载可缺省。 */
  visualReferenceAudit?: PanelVisualReferenceAudit | null;
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

export type VisualAnalysisStatus = 'disabled' | 'none' | 'analyzed' | 'partial' | 'unavailable';
export type ReferenceVisualKind =
  | 'portrait_photo' | 'still_life_photo' | 'scene_photo' | 'illustration_3d'
  | 'text_layout' | 'ui_document' | 'infographic_chart' | 'collage_mixed';

export interface VisualStyleBible {
  summary: string;
  palette: string[];
  colorTemperature: string;
  contrast: string;
  visualDensity: string;
  whitespace: string;
  hierarchy: string;
  mood: string[];
  texture: string[];
  continuityRules: string[];
  avoid: string[];
}

export interface VisualFrameSpec {
  sourceArrayIndex: number;
  sourceIndex: number;
  kind: ReferenceVisualKind;
  confidence: number;
  clusterId: string;
  sequenceRole: string;
  common: {
    aspectRatio: string; subject: string; composition: string; focalHierarchy: string; palette: string[];
    lightingOrContrast: string; negativeSpace: string; texture: string; mood: string; avoid: string[];
  };
  details: { family: string; [key: string]: unknown };
}

export interface ReferenceVisualAnalysis {
  status: VisualAnalysisStatus;
  schemaVersion: string;
  cacheKey: string | null;
  provider: string | null;
  model: string | null;
  analyzedAt: number | null;
  sourceCount: number;
  setStyleBible?: VisualStyleBible;
  styleClusters?: Array<{ id: string; label: string; frameIndexes: number[]; summary: string; palette: string[]; traits: string[] }>;
  frameSpecs?: VisualFrameSpec[];
  error?: string;
}

export type PanelContentVisualCategoryBrief =
  | {
      kind: 'portrait_photo';
      facialExpression: string; gazeDirection: string; headAngle: string; bodyLanguage: string; gesture: string; poseEnergy: string;
    }
  | {
      kind: 'text_layout';
      coreMessage: string; informationHierarchy: string[]; emphasisTerms: string[]; readingOrder: string; informationDensity: string; cardStructure: string;
    }
  | {
      kind: 'infographic_chart';
      claim: string; relationship: string; entities: string[]; direction: string; steps: string[]; dataPolicy: string;
    }
  | {
      kind: 'scene_photo';
      timeAndWeather: string; location: string; humanPresence: string; eventTrace: string; spatialRelationship: string; motionLevel: string;
    }
  | {
      kind: 'still_life_photo';
      primaryObjects: string[]; usageState: string; objectRelationship: string; lifeTrace: string; materialFocus: string; handInteraction: string;
    }
  | {
      kind: 'illustration_3d';
      coreMetaphor: string; characterRelationship: string; symbols: string[]; motionDirection: string; exaggerationLevel: string; storyStage: string;
    }
  | {
      kind: 'ui_document';
      userTask: string; interfaceState: string; componentHierarchy: string[]; interactionPath: string[]; informationFocus: string; fidelityLabel: string;
    }
  | {
      kind: 'collage_mixed';
      regions: Array<{ role: string; content: string; priority: string }>; readingOrder: string; primarySecondaryRatio: string; continuityElements: string[];
    };

export interface PanelVisualReferenceAudit {
  analysisStatus: VisualAnalysisStatus;
  analysisCacheKey: string | null;
  bindingMode: 'slot' | 'legacy_all' | 'none';
  auditEnabled: boolean;
  visualSetBrief?: {
    narrativeArc: string;
    continuityRules: string[];
    typeMixRationale: string;
    source: 'model' | 'fallback';
  };
  slots: Array<{
    slot: number;
    /** 新记录必有；旧记录缺省时由绑定信息保守推断展示。 */
    auditMode?: 'reference_fidelity' | 'content_alignment' | 'skipped';
    slotRole?: 'cover_hook' | 'context' | 'problem' | 'explanation' | 'evidence' | 'process' | 'contrast' | 'action' | 'conclusion';
    route: 'generative' | 'deterministic_text_card' | 'specialized_generative' | 'region_guided_generative';
    styleSource: 'reference_analysis' | 'category_fallback';
    binding: {
      slot: number; mode: 'slot' | 'legacy_all'; primarySourceArrayIndex: number | null; primarySourceIndex: number | null;
      references: Array<{ sourceArrayIndex: number; sourceIndex: number; url: string; role: 'style' | 'identity' | 'primary' }>;
    };
    providerReferenceStatus: 'used' | 'unsupported' | 'unavailable' | 'skipped';
    outputUrl: string | null;
    finalStatus: 'passed' | 'failed' | 'unverified' | 'skipped' | 'discarded';
    contentVisualBrief?: {
      narrativeMoment: string; emotion: string; emotionIntensity: number; action: string; environment: string;
      facialExpression?: string; gazeDirection?: string; headAngle?: string; bodyLanguage?: string; avoid: string[];
      categoryBrief?: PanelContentVisualCategoryBrief;
    };
    attempts: Array<{
      status: 'passed' | 'failed' | 'unverified' | 'skipped'; reason: string; auditedAt: number; retryGuidance?: string;
      scores?: { form: number; subject: number; composition: number; color: number; style: number; contentAlignment?: number };
      risks?: {
        recognizableRealPerson: boolean; garbledText: boolean; watermark: boolean; copiedText: boolean;
        copyCheck?: 'evaluated' | 'not_applicable'; originalityRisk: 'low' | 'medium' | 'high';
      };
    }>;
  }>;
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

export type ContentQueueStageState =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'waiting_human'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'skipped';

export interface ContentQueueStage {
  key: 'source' | 'content' | 'text_quality' | 'visual_plan' | 'image_review' | 'package' | 'approval' | 'dispatch';
  label: string;
  state: ContentQueueStageState;
  summary: string;
  facts: string[];
  progress?: { current: number; total: number };
}

export type ContentQueueJourneyStatus =
  | 'generating'
  | 'waiting_approval'
  | 'dispatching'
  | 'scheduled'
  | 'published'
  | 'submitted'
  | 'failed'
  | 'rejected'
  | 'draft'
  | 'skipped';

export interface ContentQueueJourney {
  journeyId: string;
  runId: string | null;
  recordId: number | null;
  accountId: string;
  title: string;
  sourceTitle: string | null;
  kind: 'rewrite' | 'autonomous' | 'persisted';
  startedAt: number;
  active: boolean;
  status: ContentQueueJourneyStatus;
  statusSummary: string;
  stages: ContentQueueStage[];
  snapshot: unknown | null;
}

export interface ContentQueueLifecycle {
  status: 'idle' | 'running' | 'waiting_human';
  active: ContentQueueJourney[];
  recent: ContentQueueJourney[];
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
  /** Cloud-owned eight-stage lifecycle; absent while rolling back to an older cloud. */
  lifecycle?: ContentQueueLifecycle;
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
  sourcePublishedAtText: string | null;
  sourcePublishedAt: number | null;
  sourcePublishedAtPrecision: 'minute' | 'hour' | 'day' | null;
  sourcePublishedAtStatus: 'parsed' | 'unparseable' | null;
  sourcePublishedAtObservedAt: number | null;
  botLiked: boolean;
  botCollected: boolean;
  admitReason: string | null;
  firstSeenAt: number;
  updatedAt: number;
  referenceImages: CuratedReferenceImage[];
  /** 整组视觉反推缓存；旧行/旗标关可缺省。 */
  visualAnalysis?: ReferenceVisualAnalysis;
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

export interface DelegatedTaskProgress {
  successCount: number;
  attemptCount: number;
  skippedCount: number;
  failureCount: number;
}

export interface DelegatedTaskView {
  id: string;
  accountId: string;
  accountName: string;
  platform: 'xiaohongshu' | 'facebook';
  action: string;
  /** Older Cloud versions may omit the additive task evidence below. */
  actionFamily?: 'comment' | 'publish' | 'candidate_control';
  targetSuccessCount: number;
  maxAttempts: number;
  deadlineAt: number;
  notBefore?: number;
  sourceConstraints?: Record<string, unknown>;
  approvalMode: 'review' | 'auto_approve' | 'draft_only';
  priority: 'normal' | 'high';
  status: string;
  progress: DelegatedTaskProgress;
  currentStep?: string | null;
  nextEligibleAt?: number | null;
  /** Cloud accepted cancellation but the worker still needs to settle at a safe boundary. */
  cancelRequested?: boolean;
  createdAt?: number;
  updatedAt?: number;
  version: number;
  terminalOutcome?: { code: string; message: string; submittedUnknown?: boolean } | null;
}

export interface DelegatedTaskConfirmation {
  taskId: string;
  version: number;
  title: string;
  accountName: string;
  platformLabel: string;
  actionLabel: string;
  target: string;
  attempts: string;
  schedule: string;
  approval: string;
  priority: string;
  constraints: string[];
  capability: 'supported' | 'beta';
  capabilityReason?: string;
}

export interface DelegatedTaskDraftReceipt {
  task: DelegatedTaskView;
  confirmation: DelegatedTaskConfirmation;
  created: boolean;
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

/** 视频号互动权限固定目录行（GET /api/config/interaction-permissions，只读）。 */
export interface InteractionPermissionView {
  key:
    | 'interaction.config.view'
    | 'interaction.config.edit'
    | 'interaction.config.publish'
    | 'interaction.config.preview'
    | 'interaction.dm.view_full'
    | 'interaction.audit.view';
  name: string;
  description: string;
  /** 同时存在于后台登录用户与 grants 配置中的有效用户名。 */
  users: string[];
}

export interface InteractionPermissionOverview {
  permissions: InteractionPermissionView[];
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
/** 受限动作直接复用控制台风控动作镜像，避免维护第二份联合类型。 */
export type QuotaAction = RiskAction;

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
  /** 适用 Facebook 账号分组的完整集合；空数组=不会进入自动/裸 --join 候选池。 */
  accountGroupLabels: string[];
  groupName: string | null;
  region: string | null;
  park: string | null;
  direction: string | null;
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
  updated: number;
  duplicate: number;
  invalid: number;
  rows: FacebookGroupTargetRow[];
}

export interface FacebookGroupRegionFacet {
  region: string;
  parks: string[];
}

export interface FacebookGroupTargetFacets {
  regions: FacebookGroupRegionFacet[];
  directions: string[];
  /** 当前至少由一个 Facebook 账号使用的可选分组。 */
  accountGroupLabels: string[];
  /** 没有任何账号分组范围的目标数。 */
  unscopedTargetCount: number;
}

export interface FacebookGroupTargetScopeReadback {
  groupUrl: string;
  accountGroupLabels: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface FacebookGroupTargetScopeReplaceResult {
  items: FacebookGroupTargetScopeReadback[];
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

export type ContentScheduleActionMode = 'off' | 'review' | 'auto_approve';

/** Cloud 平台注册表声明的可排期动作；Console 只消费能力投影，不自行推断平台矩阵。 */
export type ContentScheduleAutomationAction = 'post' | 'comment' | 'contact_comment' | 'join_group';

/** GET /api/content-schedule 每行携带的服务端权威动作能力。 */
export interface ContentScheduleAvailableAction {
  action: ContentScheduleAutomationAction;
  /** 允许的非关闭模式；`off` 始终作为安全关闭值由页面补入。 */
  allowedModes: Array<Exclude<ContentScheduleActionMode, 'off'>>;
  /** 该平台/动作允许写入的服务端日上限。 */
  maxDailyCap: number;
}

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

/** Facebook 最近一次 scheduled 自动加群审计；人工/旧来源不得混入。 */
export interface FacebookJoinGroupRecentResult {
  outcome: string;
  reason: string | null;
  groupUrl: string | null;
  createdAt: string;
}

/** GET /api/content-schedule 中仅 Facebook 行携带的领域聚合配置。 */
export interface FacebookJoinGroupAutomationView {
  enabled: boolean;
  dailyCap: number;
  effectiveDailyCap: number;
  weekMask: string | null;
  weekMaskSource: 'content' | 'custom';
  effectiveWeekMask: string | null;
  accountGroupLabel: string | null;
  scopedTargetCount: number;
  scopeReady: boolean;
  recentResult: FacebookJoinGroupRecentResult | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** 每账号内容排期一行（GET /api/content-schedule），含两层独立的账号覆盖与生效来源。 */
export interface ContentScheduleRow {
  accountId: string;
  /** Cloud 规范化的平台 id；未知平台保留诊断值且 availableActions 为空。 */
  platform: string;
  /** 账号当前分组；null=未分组。 */
  groupLabel: string | null;
  label: string | null;
  nickname: string | null;
  operatorAlias: string | null;
  displayName: string;
  displayNameSource: AccountDisplayNameSource;
  /** 服务端权威的可配置排期动作；Console 不维护平台动作矩阵。 */
  availableActions: ContentScheduleAvailableAction[];
  /** 仅 Facebook 行返回；非 Facebook 不伪造该领域配置。 */
  joinGroupAutomation?: FacebookJoinGroupAutomationView;
  /** 总开关：false=该账号完全不自动（零回归默认）。 */
  autoEnabled: boolean;
  /** 发帖开关。 */
  postEnabled: boolean;
  postMode: ContentScheduleActionMode;
  /** 发帖日上限；0=该动作不自动（与开关双保险）。 */
  postDailyCap: number;
  /** 自动评论开关（change content-schedule-comments）。 */
  commentEnabled: boolean;
  commentMode: ContentScheduleActionMode;
  /** 评论日上限；0=不自动。该时段「尝试」评论：自行搜索目标、可能 0 产出、每条需飞书人审。 */
  commentDailyCap: number;
  /** 自动联系评论开关（change content-schedule-group-comments；开启须过一码一号硬校验）。 */
  contactCommentEnabled: boolean;
  contactCommentMode: ContentScheduleActionMode;
  /** 联系评论每日自动尝试上限（硬 ≤10、建议 ≤3；被拒/无目标也占额度）。 */
  contactCommentDailyCap: number;
  /** 该账号是否已配联系方式（联系评论开关前置徽标）。 */
  hasContactInfo: boolean;
  /** 原始账号覆盖；null = 对应层继承全局。 */
  activeWeekMask: string | null;
  contentActiveMask: string | null;
  /** Cloud 解析后的生效值；活跃 null=全天开放，内容 null=完全不自动。 */
  effectiveActiveWeekMask: string | null;
  effectiveContentActiveMask: string | null;
  activeMaskSource: 'override' | 'global';
  contentMaskSource: 'override' | 'global';
  hasActiveOverrideMask: boolean;
  hasContentOverrideMask: boolean;
  /** 旧字段兼容：等价于内容时段来源。 */
  maskSource: 'override' | 'global';
  /** 旧字段兼容：等价于 hasContentOverrideMask。 */
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
  postMode?: ContentScheduleActionMode;
  postDailyCap?: number;
  commentEnabled?: boolean;
  commentMode?: ContentScheduleActionMode;
  commentDailyCap?: number;
  contactCommentEnabled?: boolean;
  contactCommentMode?: ContentScheduleActionMode;
  contactCommentDailyCap?: number;
  /** 每账号活跃时段覆盖：168 位 '0'/'1'，或 null=清空覆盖=继承全局。 */
  activeWeekMask?: string | null;
  /** 每账号内容时段覆盖：168 位 '0'/'1'，或 null=清空覆盖=继承全局。 */
  contentActiveMask?: string | null;
}

/** PUT /api/content-schedule/:accountId/join-group；字段均可部分提交，服务端整块校验。 */
export interface FacebookJoinGroupAutomationPatch {
  enabled?: boolean;
  dailyCap?: number;
  weekMask?: string | null;
}

export interface FacebookJoinGroupAutomationWriteResult {
  joinGroupAutomation: FacebookJoinGroupAutomationView;
}

// ── 客户端用户（对外客户鉴权后台，change edge-client-customer-auth）────────────
// 内部运营在后台管理「对外客户」：客户用 name+key 登录 edge 客户端、只看归属自己的环境。
// 契约与 cloud 内部面板端点严格对齐；列表/管理视图**绝不**含 key 明文或 hash（key 仅创建/轮换时一次性回）。

/** 客户账户启停态（cloud 联合类型，镜像；未知值按灰底兜底防白屏）。 */
export type ClientUserStatus = 'enabled' | 'disabled';

/** 客户账户后台管理视图行（GET /api/client-users）。绝不含 key/hash。时间均为 epoch ms。 */
export interface ClientUserView {
  userId: string;
  name: string;
  status: ClientUserStatus;
  /** 已归属该客户的可见环境数。 */
  envCount: number;
  /** 上次密钥轮换时间（从未轮换为 null）。 */
  rotatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 环境归属来源（cloud 联合类型，镜像）：admin=后台分配 / client=客户端登录态自建自动归属。 */
export type ClientEnvScopeSource = 'admin' | 'client';

/** 客户可见环境归属行（GET /api/client-users/:id/scope）。envKey = 环境的 AdsPower profileId。 */
export interface ClientEnvScopeRow {
  envKey: string;
  label: string | null;
  platform: string | null;
  source: ClientEnvScopeSource;
  assignedAt: number;
}

/** PUT /api/client-users/:id/scope 请求体的单条环境（整批替换；source 由服务端派生、不由前端传）。 */
export interface ClientEnvScopeInput {
  envKey: string;
  label?: string | null;
  platform?: string | null;
}

/** 某环境被归属到的一个端用户（管理侧全局注册表；仅 userId + name，绝不含 key）。 */
export interface ClientEnvAssignee {
  userId: string;
  name: string;
}

export type ClientCleanupReason = 'environment_unbind' | 'customer_terminated' | 'admin_revoked';
export type ClientOffboardState = 'pending_edge' | 'dispatched' | 'tombstoned' | 'purged';

export type ClientCleanupReceipt =
  | {
      kind: 'binding_missing';
      revocationId: string;
      envKey: string;
      state: 'binding_missing';
      reason: 'customer_terminated' | 'admin_revoked';
      requestedAt: number;
    }
  | {
      kind: 'offboard_pending';
      offboardId: string;
      envKey: string;
      accountId: string;
      state: ClientOffboardState;
      reason: ClientCleanupReason;
      requestedAt: number;
      purgeDueAt: number;
    };

export interface ClientUserMutationResponse {
  user: ClientUserView;
  /** Additive in wechat-env-ownership-revocation; absent only during a rolling deploy against an older Cloud. */
  cleanup?: ClientCleanupReceipt[];
}

export interface ClientScopeMutationResponse {
  scope: ClientEnvScopeRow[];
  /** Additive in wechat-env-ownership-revocation; absent only during a rolling deploy against an older Cloud. */
  cleanup?: ClientCleanupReceipt[];
}

/**
 * 管理侧全局环境注册表行（GET /api/client-environments；change client-user-env-picker）：
 * 系统已知的一个环境 + 它被分配给哪些端用户。跨用户聚合，受内部 JWT，仅后台可读。
 */
export interface ClientEnvironmentView {
  envKey: string;
  label: string | null;
  platform: string | null;
  assignees: ClientEnvAssignee[];
  assigneeCount: number;
  cleanup: ClientCleanupReceipt | null;
}

export type EnvironmentLifecycleState = 'active' | 'waiting_edge' | 'deleting' | 'delete_failed' | 'deleted';

/** 独立环境资产页 DTO（GET /api/environments）。环境名与挂载账号展示名严格分列。 */
export interface EnvironmentAssetView extends ClientEnvironmentView {
  environmentName: string;
  account: {
    accountId: string;
    label: string | null;
    nickname: string | null;
    operatorAlias: string | null;
    displayName: string;
    platform: string;
    groupLabel: string | null;
    riskStatus: RiskStatus | null;
    riskQuotaLevel: RiskQuotaLevel | null;
  } | null;
  bindingObservedAt: number | null;
  installation: { installationId: string; lastSeenAt: number; online: boolean } | null;
  lifecycle: {
    state: EnvironmentLifecycleState;
    requestId: string | null;
    requestedBy: string | null;
    requestedAt: number | null;
    resultKind: 'deleted' | 'already_missing' | null;
    resultError: string | null;
    resultAt: number | null;
    deletedAt: number | null;
  };
}

/**
 * 边缘客户端安装包清单（change downloads-manifest-from-host）：由云端**现扫本机 downloads 目录**得出。
 * 版本与文件名绝不来自前端源码——那是「哪台机器上放了哪个包」的部署状态。
 * 没有可用包时 `version=null` + `items=[]`（诚实为空，前端据此显示「暂无可用安装包」）。
 */
export interface DownloadItem {
  key: 'mac-arm64' | 'mac-x64' | 'win-x64';
  label: string;
  file: string;
  version: string;
}

export interface DownloadsManifest {
  version: string | null;
  items: DownloadItem[];
}
