/** TanStack Query hooks（所有 /api 读）。写 mutation 见各页面 useMutation。 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import type {
  VersionPayload,
  DashboardSummary,
  PanelAccount,
  PanelPublish,
  ContentQueue,
  LikeRate,
  Alert,
  PanelInteraction,
  ModelConfig,
  RoleConfigCatalog,
  CategoryConfigCatalog,
  PersonaConfigCatalog,
  QuotaConfigCatalog,
  SessionLimitCatalog,
  ResumeConfigCatalog,
  LlmUsagePayload,
  PanelNotificationContact,
} from '../types/api';

export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => apiGet<VersionPayload>('/api/version'),
    staleTime: 60_000,
  });
}

/** 模型与凭据配置（change console-model-provider-config）。 */
export function useModelConfig() {
  return useQuery({
    queryKey: ['config', 'model'],
    queryFn: () => apiGet<ModelConfig>('/api/config/model'),
  });
}

/** 角色级模型/温度配置目录（change console-role-model-config）。 */
export function useRoleConfig() {
  return useQuery({
    queryKey: ['config', 'roles'],
    queryFn: () => apiGet<RoleConfigCatalog>('/api/roles'),
  });
}

/** 分类级模型默认配置目录（change role-model-category-config，item 5/6）。 */
export function useCategoryConfig() {
  return useQuery({
    queryKey: ['config', 'categories'],
    queryFn: () => apiGet<CategoryConfigCatalog>('/api/categories'),
  });
}

/** 安全限额配置目录（change safety-quota-config，stream D）。三档×动作×三窗口生效值 + 审计。 */
export function useQuotaConfig() {
  return useQuery({
    queryKey: ['config', 'quotas'],
    queryFn: () => apiGet<QuotaConfigCatalog>('/api/quotas'),
  });
}

/** 单场会话上限配置目录（change session-limits-to-quota-layer）。按账号时长 + 六项互动预算 + 审计。 */
export function useSessionLimits() {
  return useQuery({
    queryKey: ['config', 'session-limits'],
    queryFn: () => apiGet<SessionLimitCatalog>('/api/session-limits'),
  });
}

/** 自动续场护栏 + 看门狗阈值配置目录（change session-auto-resume-with-excursions）。按账号 + 审计。 */
export function useResumeConfig() {
  return useQuery({
    queryKey: ['config', 'resume-config'],
    queryFn: () => apiGet<ResumeConfigCatalog>('/api/resume-config'),
  });
}

/** 账号人设配置目录（change account-persona-config，stream F）。单账号详情在页面内按需 apiGet。 */
export function usePersonaConfig() {
  return useQuery({
    queryKey: ['config', 'personas'],
    queryFn: () => apiGet<PersonaConfigCatalog>('/api/persona'),
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiGet<DashboardSummary>('/api/dashboard/summary'),
    refetchInterval: 15_000,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiGet<{ accounts: PanelAccount[] }>('/api/accounts'),
  });
}

/** 已发布历史（change publish-history-account-and-detail）；可选按账号过滤。 */
export function usePublished(accountId?: string) {
  return useQuery({
    queryKey: ['content', 'published', accountId ?? 'all'],
    queryFn: () =>
      apiGet<{ items: PanelPublish[] }>(
        `/api/content/published${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`,
      ),
  });
}

export function useContentQueue() {
  return useQuery({
    queryKey: ['content', 'queue'],
    queryFn: () => apiGet<ContentQueue>('/api/content/queue'),
    refetchInterval: 10_000,
  });
}

export function useLikeRate() {
  return useQuery({
    queryKey: ['analytics', 'like-rate'],
    queryFn: () => apiGet<LikeRate>('/api/analytics/like-rate'),
  });
}

/** 告警只读流（V1 task 9.5）：默认仅未解决，5s 轮询。 */
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => apiGet<{ alerts: Alert[] }>('/api/alerts'),
    refetchInterval: 5_000,
  });
}

/** 按笔记互动历史（V1 task 9.2）；可按账号过滤。 */
export function useInteractions(accountId?: string) {
  return useQuery({
    queryKey: ['monitor', 'interactions', accountId ?? 'all'],
    queryFn: () =>
      apiGet<{ interactions: PanelInteraction[] }>(
        `/api/monitor/interactions${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`,
      ),
    refetchInterval: 10_000,
  });
}

/** token 用量统计（change llm-token-usage-stats）：表格行 + 10 分钟曲线桶，一次取回。 */
export interface LlmUsageParams {
  fromMs?: number;
  toMs?: number;
  accountId?: string;
  role?: string;
  model?: string;
}

export function useLlmUsage(params: LlmUsageParams) {
  const qs = new URLSearchParams();
  if (params.fromMs !== undefined) qs.set('from', String(params.fromMs));
  if (params.toMs !== undefined) qs.set('to', String(params.toMs));
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.role) qs.set('role', params.role);
  if (params.model) qs.set('model', params.model);
  const suffix = qs.toString();
  return useQuery({
    queryKey: ['llm-usage', suffix],
    queryFn: () => apiGet<LlmUsagePayload>(`/api/llm-usage${suffix ? `?${suffix}` : ''}`),
    refetchInterval: 60_000,
  });
}

/**
 * 通知联系人名册（change notification-contact-registry）：按账号取联系人列表。
 * 强制按账号（accountId 必填）—— 不提供全账号合并视图（PII 隔离）；accountId 为空时不查。
 */
export function useNotificationContacts(accountId: string | undefined) {
  return useQuery({
    queryKey: ['notification-contacts', accountId],
    enabled: !!accountId,
    queryFn: () =>
      apiGet<{ contacts: PanelNotificationContact[] }>(
        `/api/notification/contacts?accountId=${encodeURIComponent(accountId!)}`,
      ),
  });
}
