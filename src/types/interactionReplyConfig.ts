/**
 * 视频号账号级互动回复配置 DTO。
 *
 * 单一契约来源：aidcp control repo
 * docs/contracts/wechat-channels-interaction/v1/schemas/internal-api.schema.json（v1）。
 * 前端只镜像传输结构；模板渲染、规则判定、AI 和风险结论均由 Cloud 返回。
 */

export type InteractionChannel = 'comment' | 'dm';
export type InteractionMessageType = 'text' | 'image' | 'unknown';
export type ReplyMode = 'draft_only' | 'review_before_send' | 'auto_safe';
export type PreviewConfigUse = 'draft' | 'published';
export type PreviewAction = 'draft' | 'review_required' | 'would_auto_send' | 'no_match' | 'blocked';
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type TemplateVariable = 'user_name' | 'video_title' | 'account_name' | 'support_channel';
export type ReplyTone = 'professional' | 'friendly' | 'concise';
export type ReplyIntent =
  | 'gratitude'
  | 'general_question'
  | 'product_question'
  | 'support_request'
  | 'complaint'
  | 'order'
  | 'refund'
  | 'pricing'
  | 'promotion'
  | 'inventory'
  | 'shipping'
  | 'personal_data'
  | 'medical'
  | 'legal'
  | 'abuse'
  | 'minor_safety'
  | 'other'
  | 'unknown';
export type RiskTag =
  | 'order'
  | 'refund'
  | 'after_sales'
  | 'pricing'
  | 'promotion'
  | 'inventory'
  | 'shipping'
  | 'personal_data'
  | 'complaint'
  | 'dispute'
  | 'legal'
  | 'medical'
  | 'safety'
  | 'abuse'
  | 'minor_safety'
  | 'meaning_changed'
  | 'introduced_claim'
  | 'unknown';

export interface ResponseMeta {
  requestId: string;
  asOf: number;
}

export interface InternalApiEnvelope<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ConfigHead {
  accountId: string;
  platform: 'wechat_channels';
  currentVersion: number;
  draftVersion: number | null;
  publishedVersion: number | null;
  updatedAt: number;
  updatedBy: string;
}

export interface RuntimeControls {
  accountId: string;
  platform: 'wechat_channels';
  version: number;
  commentsReadEnabled: boolean;
  commentsReplyEnabled: boolean;
  dmReadEnabled: boolean;
  dmSendTextEnabled: boolean;
  dmSendImageEnabled: false;
  writePaused: boolean;
  circuitOpen: boolean;
  circuitOpenedAt: number | null;
  consecutiveFailures: number;
  updatedAt: number;
  updatedBy: string;
}

export interface PolicyChannel {
  enabled: boolean;
  aiPolishEnabled: boolean;
  allowAutoSend: boolean;
}

export interface RateLimits {
  accountPerMinute: number;
  accountPerHour: number;
  accountPerDay: number;
  threadCooldownSeconds: number;
  newLoginCooldownSeconds: number;
  consecutiveFailureLimit: number;
}

export interface ReplyPolicy {
  mode: ReplyMode;
  generateDrafts: boolean;
  sendReplies: boolean;
  channels: Record<InteractionChannel, PolicyChannel>;
  rateLimits: RateLimits;
}

export interface ReplyTemplate {
  templateId: string;
  channel: InteractionChannel;
  name: string;
  content: string;
  enabled: boolean;
  archived: boolean;
  templateVersion: number;
  variables: TemplateVariable[];
  updatedAt: number;
  updatedBy: string;
}

export interface WorkHours {
  timezone: string;
  start: string;
  end: string;
}

export interface RuleConditions {
  keywordsAny: string[];
  intentsAny: ReplyIntent[];
  sourceExternalIds: string[];
  messageTypes: InteractionMessageType[];
  workHours: WorkHours | null;
}

export interface RuleActions {
  templateId: string;
  polish: boolean;
  allowAutoSend: boolean;
  forceHumanTags: RiskTag[];
}

export interface ReplyRule {
  ruleId: string;
  channel: InteractionChannel;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
  updatedAt: number;
  updatedBy: string;
}

export interface VariableFallbacks {
  user_name: string;
  video_title: string;
  account_name: string;
  support_channel: string;
}

export interface ReplyProfile {
  channel: InteractionChannel;
  selfName: string;
  userAddress: string;
  tone: ReplyTone[];
  maxLength: number;
  allowEmoji: boolean;
  allowLinks: boolean;
  blockedPhrases: string[];
  disallowedClaims: string[];
  requiredDisclaimer: string | null;
  /** Optional Markdown/plain-text facts used only by the channel AI polisher. */
  knowledgeDocument?: string | null;
  variableFallbacks: VariableFallbacks;
}

export type RuntimeControlsResponse = InternalApiEnvelope<RuntimeControls>;
export type PolicyResponse = InternalApiEnvelope<{ head: ConfigHead; policy: ReplyPolicy }>;
export type TemplateListResponse = InternalApiEnvelope<{
  accountId: string;
  currentVersion: number;
  items: ReplyTemplate[];
  nextCursor: string | null;
}>;
export type RuleListResponse = InternalApiEnvelope<{
  accountId: string;
  currentVersion: number;
  items: ReplyRule[];
  nextCursor: string | null;
}>;
export type ProfileResponse = InternalApiEnvelope<{
  accountId: string;
  currentVersion: number;
  profiles: ReplyProfile[];
}>;

export interface PreviewRequest {
  expectedVersion: number;
  use: PreviewConfigUse;
  channel: InteractionChannel;
  messageType: InteractionMessageType;
  userMessage: string | null;
  videoTitle: string | null;
  userName: string | null;
}

export interface PreviewContext {
  threadId: string;
  messageId: string;
  channel: InteractionChannel;
  messageType: InteractionMessageType;
  userMessage: string | null;
  userName: string | null;
  videoTitle: string | null;
  receivedAt: number;
}

export type PreviewContextsResponse = InternalApiEnvelope<{
  accountId: string;
  items: PreviewContext[];
}>;

export interface PreviewResult {
  accountId: string;
  configVersion: number;
  matchedRule: { ruleId: string; reason: string } | null;
  template: { templateId: string; templateVersion: number; renderedText: string } | null;
  polish: {
    before: string;
    after: string;
    fallbackUsed: boolean;
    meaningChanged: boolean;
    introducedClaims: string[];
  } | null;
  risk: { level: RiskLevel; tags: RiskTag[]; reasons: string[] };
  action: PreviewAction;
}

export type PreviewResponse = InternalApiEnvelope<PreviewResult>;

export interface PublishResult {
  head: ConfigHead;
  publishedAt: number;
  publishedBy: string;
}

export type PublishResponse = InternalApiEnvelope<PublishResult>;

export interface InitializeRequest {
  expectedVersion: 0;
}

export type InitializeResponse = InternalApiEnvelope<{
  head: ConfigHead;
  initializedVersion: number;
}>;

export type AuditAction = 'draft_saved' | 'template_archived' | 'config_initialized' | 'config_published' | 'previewed';
export type AuditEntityType = 'policy' | 'template' | 'rule' | 'profile' | 'config' | 'preview';

export interface AuditItem {
  eventId: string;
  actor: string;
  /** Wire 枚举开放读取：已知值做中文映射，Cloud 先扩值时仍显示原值。 */
  action: string;
  configVersion: number;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: number;
}

export type AuditResponse = InternalApiEnvelope<{
  accountId: string;
  items: AuditItem[];
  nextCursor: string | null;
}>;

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface InteractionErrorDetails {
  currentVersion?: number;
  retryAfterMs?: number;
  issues?: ValidationIssue[];
}

export interface ReplyConfigSnapshot {
  runtime: RuntimeControls;
  head: ConfigHead;
  policy: ReplyPolicy;
  templates: ReplyTemplate[];
  rules: ReplyRule[];
  profiles: ReplyProfile[];
}

export interface RuntimeControlsUpdate {
  expectedVersion: number;
  commentsReadEnabled: boolean;
  commentsReplyEnabled: boolean;
  dmReadEnabled: boolean;
  dmSendTextEnabled: boolean;
  dmSendImageEnabled: false;
  writePaused: boolean;
}

export interface PolicyUpdate {
  expectedVersion: number;
  policy: ReplyPolicy;
}

export interface TemplateWrite {
  expectedVersion: number;
  template: ReplyTemplate;
}

export interface RuleWrite {
  expectedVersion: number;
  rule: ReplyRule;
}

export interface ProfileWrite {
  expectedVersion: number;
  profiles: ReplyProfile[];
}

export interface PublishRequest {
  expectedVersion: number;
}

/** v2: 视频号回复策略按账号分组（或未分组默认项）聚合。 */
export type ReplyConfigScopeType = 'group' | 'default';
export type ReplyConfigResolutionMode = 'scoped';

export interface ReplyConfigSource {
  type: ReplyConfigScopeType;
  groupLabel: string | null;
}

export interface ReplyConfigScopeHead {
  scopeId: string;
  platform: 'wechat_channels';
  source: ReplyConfigSource;
  memberCount: number;
  currentVersion: number;
  draftVersion: number | null;
  publishedVersion: number | null;
  updatedAt: number;
  updatedBy: string;
}

export interface ReplyConfigScopeSummary extends Omit<ReplyConfigScopeHead, 'scopeId' | 'updatedAt' | 'updatedBy'> {
  scopeId: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface ReplyConfigScopeSnapshot {
  accountId: '';
  configScopeId: string;
  configSource: ReplyConfigSource;
  platform: 'wechat_channels';
  configVersion: number;
  state: 'draft' | 'published';
  policy: ReplyPolicy;
  templates: ReplyTemplate[];
  rules: ReplyRule[];
  profiles: ReplyProfile[];
  createdAt: number;
  createdBy: string;
  publishedAt: number | null;
  publishedBy: string | null;
}

export type ReplyConfigScopeListResponse = InternalApiEnvelope<{ items: ReplyConfigScopeSummary[] }>;
export type ReplyConfigScopeDetailResponse = InternalApiEnvelope<{
  head: ReplyConfigScopeHead;
  snapshot: ReplyConfigScopeSnapshot | null;
}>;
export type ReplyConfigScopeWriteResponse = InternalApiEnvelope<{
  head: ReplyConfigScopeHead;
  snapshot?: ReplyConfigScopeSnapshot;
  initializedVersion?: number;
  publishedAt?: number;
  publishedBy?: string;
  memberCount?: number;
}>;
export type ReplyConfigScopeAuditResponse = InternalApiEnvelope<{
  scopeId: string;
  items: AuditItem[];
  nextCursor: string | null;
}>;

export interface EffectiveReplyConfigResponseData {
  accountId: string;
  mode: ReplyConfigResolutionMode;
  status: 'missing' | 'draft_only' | 'published' | 'unknown';
  reason: 'group_config_missing' | 'default_config_missing' | 'account_not_found' | null;
  source: ReplyConfigSource;
  currentVersion: number | null;
  draftVersion: number | null;
  publishedVersion: number | null;
}

export type EffectiveReplyConfigResponse = InternalApiEnvelope<EffectiveReplyConfigResponseData>;
