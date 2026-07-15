import { apiDelete, apiGet, apiPost, apiPut } from './client';
import type {
  AuditResponse,
  InternalApiEnvelope,
  PolicyResponse,
  PolicyUpdate,
  PreviewRequest,
  PreviewResponse,
  ProfileResponse,
  ProfileWrite,
  PublishRequest,
  PublishResponse,
  ReplyConfigSnapshot,
  RuleListResponse,
  RuleWrite,
  RuntimeControlsResponse,
  RuntimeControlsUpdate,
  TemplateListResponse,
  TemplateWrite,
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
    profiles: profiles.data.profiles,
  };
}

export async function loadReplyAudit(accountId: string, signal?: AbortSignal): Promise<AuditResponse> {
  const response = await apiGet<AuditResponse>(`${basePath(accountId)}/reply-config/audit`, { signal });
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
  return apiPut(`${basePath(accountId)}/reply-profile`, body);
}

export function previewReply(accountId: string, body: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> {
  return apiPost(`${basePath(accountId)}/reply-preview`, body, { signal });
}

export function publishReplyConfig(accountId: string, body: PublishRequest): Promise<PublishResponse> {
  return apiPost(`${basePath(accountId)}/reply-config/publish`, body);
}
