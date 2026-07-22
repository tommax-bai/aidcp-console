import { ApiError, apiDelete, apiGet, apiPost, apiPut } from './client';
import type {
  AuditResponse,
  InternalApiEnvelope,
  InitializeRequest,
  InitializeResponse,
  PolicyResponse,
  PolicyUpdate,
  PreviewContextsResponse,
  PreviewRequest,
  PreviewResponse,
  ProfileResponse,
  ProfileWrite,
  PublishRequest,
  PublishResponse,
  ReplyConfigSnapshot,
  ReplyConfigScopeAuditResponse,
  ReplyConfigScopeDetailResponse,
  ReplyConfigScopeHead,
  ReplyConfigScopeListResponse,
  ReplyConfigScopeSnapshot,
  ReplyConfigScopeSummary,
  ReplyConfigScopeWriteResponse,
  ReplyConfigSource,
  RuleListResponse,
  RuleWrite,
  RuntimeControlsResponse,
  RuntimeControlsUpdate,
  TemplateListResponse,
  TemplateWrite,
  EffectiveReplyConfigResponse,
  RuntimeControls,
  ReplyProfile,
} from '../types/interactionReplyConfig';

/** 响应 scope 与当前抽屉账号不一致时拒绝落入 UI，避免任何跨账号旧响应覆盖。 */
export class ReplyConfigScopeError extends Error {
  constructor() {
    super('reply_config_scope_mismatch');
    this.name = 'ReplyConfigScopeError';
  }
}

function basePath(accountId: string): string {
  return `/api/accounts/${encodeURIComponent(accountId)}`;
}

function assertAccount(expected: string, actual: string, platform?: string): void {
  if (actual !== expected || (platform !== undefined && platform !== 'wechat_channels')) {
    throw new ReplyConfigScopeError();
  }
}

function normalizeReplyProfiles(profiles: ReplyProfile[]): ReplyProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    knowledgeDocument: profile.knowledgeDocument?.trim() || null,
  }));
}

function normalizeProfileWrite(body: ProfileWrite): ProfileWrite {
  return { ...body, profiles: normalizeReplyProfiles(body.profiles) };
}

/** 一次读取同一 aggregate 的配置切片；版本不同表示读取期间有并发写，拒绝拼成伪快照。 */
export async function loadReplyConfig(accountId: string, signal?: AbortSignal): Promise<ReplyConfigSnapshot> {
  const base = basePath(accountId);
  const opts = { signal };
  const [runtime, policy, templates, rules, profiles] = await Promise.all([
    apiGet<RuntimeControlsResponse>(`${base}/interaction-runtime-controls`, opts),
    apiGet<PolicyResponse>(`${base}/interaction-reply-policy`, opts),
    apiGet<TemplateListResponse>(`${base}/reply-templates`, opts),
    apiGet<RuleListResponse>(`${base}/reply-rules`, opts),
    apiGet<ProfileResponse>(`${base}/reply-profile`, opts),
  ]);

  assertAccount(accountId, runtime.data.accountId, runtime.data.platform);
  assertAccount(accountId, policy.data.head.accountId, policy.data.head.platform);
  assertAccount(accountId, templates.data.accountId);
  assertAccount(accountId, rules.data.accountId);
  assertAccount(accountId, profiles.data.accountId);

  const version = policy.data.head.currentVersion;
  if (
    templates.data.currentVersion !== version ||
    rules.data.currentVersion !== version ||
    profiles.data.currentVersion !== version
  ) {
    throw new Error('reply_config_snapshot_version_mismatch');
  }

  return {
    runtime: runtime.data,
    head: policy.data.head,
    policy: policy.data.policy,
    templates: templates.data.items,
    rules: rules.data.items,
    profiles: normalizeReplyProfiles(profiles.data.profiles),
  };
}

/** 账号运行控制独立于共享策略；不要求该账号存在 legacy 回复配置。 */
export async function loadReplyRuntimeConfig(accountId: string, signal?: AbortSignal): Promise<ReplyConfigSnapshot> {
  const response = await apiGet<RuntimeControlsResponse>(`${basePath(accountId)}/interaction-runtime-controls`, { signal });
  assertAccount(accountId, response.data.accountId, response.data.platform);
  return {
    runtime: response.data,
    head: {
      accountId,
      platform: 'wechat_channels',
      currentVersion: 0,
      draftVersion: null,
      publishedVersion: null,
      updatedAt: response.data.updatedAt,
      updatedBy: response.data.updatedBy,
    },
    policy: {
      mode: 'draft_only',
      generateDrafts: false,
      sendReplies: false,
      channels: {
        comment: { enabled: false, aiPolishEnabled: false, allowAutoSend: false },
        dm: { enabled: false, aiPolishEnabled: false, allowAutoSend: false },
      },
      rateLimits: {
        accountPerMinute: 0,
        accountPerHour: 0,
        accountPerDay: 0,
        threadCooldownSeconds: 0,
        newLoginCooldownSeconds: 0,
        consecutiveFailureLimit: 1,
      },
    },
    templates: [],
    rules: [],
    profiles: [],
  };
}

export async function loadReplyAudit(
  accountId: string,
  signal?: AbortSignal,
  cursor?: string,
): Promise<AuditResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await apiGet<AuditResponse>(`${basePath(accountId)}/reply-config/audit${query}`, { signal });
  assertAccount(accountId, response.data.accountId);
  return response;
}

export function saveRuntimeControls(
  accountId: string,
  body: RuntimeControlsUpdate,
): Promise<InternalApiEnvelope<unknown>> {
  return apiPut(`${basePath(accountId)}/interaction-runtime-controls`, body);
}

export function saveReplyPolicy(accountId: string, body: PolicyUpdate): Promise<InternalApiEnvelope<unknown>> {
  return apiPut(`${basePath(accountId)}/interaction-reply-policy`, body);
}

export function saveReplyTemplate(
  accountId: string,
  body: TemplateWrite,
  existing: boolean,
): Promise<InternalApiEnvelope<unknown>> {
  const path = existing
    ? `${basePath(accountId)}/reply-templates/${encodeURIComponent(body.template.templateId)}`
    : `${basePath(accountId)}/reply-templates`;
  return existing ? apiPut(path, body) : apiPost(path, body);
}

export function archiveReplyTemplate(
  accountId: string,
  templateId: string,
  expectedVersion: number,
): Promise<InternalApiEnvelope<unknown>> {
  return apiDelete(`${basePath(accountId)}/reply-templates/${encodeURIComponent(templateId)}`, { expectedVersion });
}

export function saveReplyRule(
  accountId: string,
  body: RuleWrite,
  existing: boolean,
): Promise<InternalApiEnvelope<unknown>> {
  const path = existing
    ? `${basePath(accountId)}/reply-rules/${encodeURIComponent(body.rule.ruleId)}`
    : `${basePath(accountId)}/reply-rules`;
  return existing ? apiPut(path, body) : apiPost(path, body);
}

export function deleteReplyRule(
  accountId: string,
  ruleId: string,
  expectedVersion: number,
): Promise<InternalApiEnvelope<unknown>> {
  return apiDelete(`${basePath(accountId)}/reply-rules/${encodeURIComponent(ruleId)}`, { expectedVersion });
}

export function saveReplyProfiles(accountId: string, body: ProfileWrite): Promise<InternalApiEnvelope<unknown>> {
  return apiPut(`${basePath(accountId)}/reply-profile`, normalizeProfileWrite(body));
}

export function previewReply(accountId: string, body: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> {
  return apiPost(`${basePath(accountId)}/reply-preview`, body, { signal });
}

export async function loadReplyPreviewContexts(
  accountId: string,
  channel: 'comment' | 'dm',
  signal?: AbortSignal,
): Promise<PreviewContextsResponse> {
  const response = await apiGet<PreviewContextsResponse>(
    `${basePath(accountId)}/reply-preview-contexts?channel=${encodeURIComponent(channel)}&limit=20`,
    { signal },
  );
  assertAccount(accountId, response.data.accountId);
  return response;
}

export function publishReplyConfig(accountId: string, body: PublishRequest): Promise<PublishResponse> {
  return apiPost(`${basePath(accountId)}/reply-config/publish`, body);
}

export async function initializeReplyConfig(accountId: string, body: InitializeRequest): Promise<InitializeResponse> {
  const response = await apiPost<InitializeResponse>(`${basePath(accountId)}/reply-config/initialize`, body);
  assertAccount(accountId, response.data.head.accountId, response.data.head.platform);
  return response;
}

const scopeRoot = '/api/interaction-reply-config-scopes';

function scopePath(scopeId: string): string {
  return `${scopeRoot}/${encodeURIComponent(scopeId)}`;
}

function scopeHeadToConfigHead(head: ReplyConfigScopeHead) {
  return {
    accountId: head.scopeId,
    platform: head.platform,
    currentVersion: head.currentVersion,
    draftVersion: head.draftVersion,
    publishedVersion: head.publishedVersion,
    updatedAt: head.updatedAt,
    updatedBy: head.updatedBy,
  } as const;
}

function unavailableRuntime(accountId: string): RuntimeControls {
  return {
    accountId,
    platform: 'wechat_channels',
    version: 0,
    commentsReadEnabled: false,
    commentsReplyEnabled: false,
    dmReadEnabled: false,
    dmSendTextEnabled: false,
    dmSendImageEnabled: false,
    writePaused: true,
    circuitOpen: false,
    circuitOpenedAt: null,
    consecutiveFailures: 0,
    updatedAt: 0,
    updatedBy: '—',
  };
}

function scopeSnapshotToEditor(
  head: ReplyConfigScopeHead,
  snapshot: ReplyConfigScopeSnapshot,
  runtime: RuntimeControls,
): ReplyConfigSnapshot {
  if (snapshot.configScopeId !== head.scopeId || snapshot.configVersion !== head.currentVersion) {
    throw new ReplyConfigScopeError();
  }
  return {
    runtime,
    head: scopeHeadToConfigHead(head),
    policy: snapshot.policy,
    templates: snapshot.templates,
    rules: snapshot.rules,
    profiles: normalizeReplyProfiles(snapshot.profiles),
  };
}

export function listReplyConfigScopes(signal?: AbortSignal): Promise<ReplyConfigScopeListResponse> {
  return apiGet(scopeRoot, { signal });
}

export async function ensureReplyConfigScope(
  source: ReplyConfigSource,
): Promise<ReplyConfigScopeSummary> {
  const response = await apiPost<ReplyConfigScopeWriteResponse>(scopeRoot, source);
  return response.data.head;
}

export async function loadScopeReplyConfig(
  scopeId: string,
  runtimeAccountId?: string,
  signal?: AbortSignal,
): Promise<ReplyConfigSnapshot> {
  const [detail, runtimeResponse] = await Promise.all([
    apiGet<ReplyConfigScopeDetailResponse>(scopePath(scopeId), { signal }),
    runtimeAccountId
      ? apiGet<RuntimeControlsResponse>(`${basePath(runtimeAccountId)}/interaction-runtime-controls`, { signal })
      : Promise.resolve(null),
  ]);
  if (detail.data.head.scopeId !== scopeId) throw new ReplyConfigScopeError();
  if (!detail.data.snapshot) throw new ApiError(404, 'INTERACTION_CONFIG_MISSING');
  const runtime = runtimeResponse?.data ?? unavailableRuntime(runtimeAccountId ?? '');
  if (runtimeAccountId && runtime.accountId !== runtimeAccountId) throw new ReplyConfigScopeError();
  return scopeSnapshotToEditor(detail.data.head, detail.data.snapshot, runtime);
}

export async function loadScopeReplyAudit(
  scopeId: string,
  signal?: AbortSignal,
  cursor?: string,
): Promise<AuditResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await apiGet<ReplyConfigScopeAuditResponse>(`${scopePath(scopeId)}/audit${query}`, { signal });
  if (response.data.scopeId !== scopeId) throw new ReplyConfigScopeError();
  return { ...response, data: { accountId: scopeId, items: response.data.items, nextCursor: response.data.nextCursor } };
}

export function initializeScopeReplyConfig(scopeId: string, body: InitializeRequest): Promise<ReplyConfigScopeWriteResponse> {
  return apiPost(`${scopePath(scopeId)}/initialize`, body);
}

export function saveScopeReplyPolicy(scopeId: string, body: PolicyUpdate): Promise<ReplyConfigScopeWriteResponse> {
  return apiPut(`${scopePath(scopeId)}/policy`, body);
}

export function saveScopeReplyTemplate(
  scopeId: string,
  body: TemplateWrite,
  existing: boolean,
): Promise<ReplyConfigScopeWriteResponse> {
  const path = existing
    ? `${scopePath(scopeId)}/templates/${encodeURIComponent(body.template.templateId)}`
    : `${scopePath(scopeId)}/templates`;
  return existing ? apiPut(path, body) : apiPost(path, body);
}

export function archiveScopeReplyTemplate(
  scopeId: string,
  templateId: string,
  expectedVersion: number,
): Promise<ReplyConfigScopeWriteResponse> {
  return apiDelete(`${scopePath(scopeId)}/templates/${encodeURIComponent(templateId)}`, { expectedVersion });
}

export function saveScopeReplyRule(
  scopeId: string,
  body: RuleWrite,
  existing: boolean,
): Promise<ReplyConfigScopeWriteResponse> {
  const path = existing
    ? `${scopePath(scopeId)}/rules/${encodeURIComponent(body.rule.ruleId)}`
    : `${scopePath(scopeId)}/rules`;
  return existing ? apiPut(path, body) : apiPost(path, body);
}

export function deleteScopeReplyRule(
  scopeId: string,
  ruleId: string,
  expectedVersion: number,
): Promise<ReplyConfigScopeWriteResponse> {
  return apiDelete(`${scopePath(scopeId)}/rules/${encodeURIComponent(ruleId)}`, { expectedVersion });
}

export function saveScopeReplyProfiles(scopeId: string, body: ProfileWrite): Promise<ReplyConfigScopeWriteResponse> {
  return apiPut(`${scopePath(scopeId)}/profiles`, normalizeProfileWrite(body));
}

export function previewScopeReply(
  scopeId: string,
  accountId: string,
  body: PreviewRequest,
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  return apiPost(`${scopePath(scopeId)}/preview`, { accountId, ...body }, { signal });
}

export async function publishScopeReplyConfig(
  scopeId: string,
  body: PublishRequest,
): Promise<PublishResponse> {
  const response = await apiPost<ReplyConfigScopeWriteResponse>(`${scopePath(scopeId)}/publish`, body);
  if (response.data.head.scopeId !== scopeId) throw new ReplyConfigScopeError();
  return {
    ...response,
    data: {
      head: scopeHeadToConfigHead(response.data.head),
      publishedAt: response.data.publishedAt ?? Date.now(),
      publishedBy: response.data.publishedBy ?? response.data.head.updatedBy,
    },
  };
}

export function loadEffectiveReplyConfig(
  accountId: string,
  signal?: AbortSignal,
): Promise<EffectiveReplyConfigResponse> {
  return apiGet(`${basePath(accountId)}/effective-reply-config`, { signal });
}
