/** TanStack Query hooks（所有 /api 读）。写 mutation 见各页面 useMutation；唯一例外见 useResolveAlert（集中承载告警解决的诚实文案）。 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { apiGet, apiPost } from './client';
import type {
  VersionPayload,
  DashboardSummary,
  PanelAccount,
  PanelPublish,
  ContentQueue,
  LikeRate,
  PanelInteraction,
  ModelConfig,
  RoleConfigCatalog,
  CategoryConfigCatalog,
  PersonaConfigCatalog,
  QuotaConfigCatalog,
  PacingConfigView,
  SessionLimitView,
  ResumeConfigView,
  LlmUsagePayload,
  PanelNotificationContact,
  CuratedContentList,
  CuratedFacets,
  ContentScheduleGlobalView,
  ContentScheduleCatalog,
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

/** 节奏兜底配置目录（change pacing-floor-config-min-interval）。每类操作（action/scroll/card_gap/detail_dwell）最小间隔兜底区间生效值 + 覆盖标记 + 审计。 */
export function usePacingConfig() {
  return useQuery({
    queryKey: ['config', 'pacing'],
    queryFn: () => apiGet<PacingConfigView>('/api/pacing'),
  });
}

/** 单场会话上限配置（全局单例，change restore-auto-resume-and-global-safety-config）。时长 + 六项互动预算 + 审计；对所有账号生效。 */
export function useSessionLimits() {
  return useQuery({
    queryKey: ['config', 'session-limits'],
    queryFn: () => apiGet<SessionLimitView>('/api/session-limits'),
  });
}

/** 自动续场护栏 + 看门狗阈值配置（全局单例，change restore-auto-resume-and-global-safety-config）。对所有账号生效 + 审计。 */
export function useResumeConfig() {
  return useQuery({
    queryKey: ['config', 'resume-config'],
    queryFn: () => apiGet<ResumeConfigView>('/api/resume-config'),
  });
}

/** 全局「内容可自动时段」周历格（change content-schedule-auto-publish，Phase 1）。fail-closed：null=不自动。 */
export function useContentScheduleGlobal() {
  return useQuery({
    queryKey: ['config', 'content-schedule', 'global'],
    queryFn: () => apiGet<ContentScheduleGlobalView>('/api/content-schedule/global'),
  });
}

/** 每账号内容排期目录（change content-schedule-auto-publish，Phase 1 只发帖）。总开关/发帖开关/日上限/时段来源。 */
export function useContentSchedule() {
  return useQuery({
    queryKey: ['config', 'content-schedule'],
    queryFn: () => apiGet<ContentScheduleCatalog>('/api/content-schedule'),
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
    // change dashboard-refresh-clarity：10s 轮询 + 回窗即刷（块级覆盖 main.tsx 全局 false），
    // 配合响应 asOf 渲染「数据截至 …」——每轮刷新 asOf 推进即证明界面未冻结。
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
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

/**
 * 告警手动解决（change alert-resolution-by-id）：按 alert_id 勾销单条未解决告警。
 * 诚实：resolved===1 → 「已解决」；0 → 「已解决或不存在」，绝不笼统报成功。
 * 成功后失效 ['dashboard','summary']——监控页并入首页（merge-monitor-into-dashboard）后，
 * 告警列表仅剩首页一处、数据统一来自汇总接口（原监控页独立 5s 告警流 useAlerts 已退役；/api/alerts 端点仍在）。
 */
export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<{ resolved: number }>(`/api/alerts/${id}/resolve`),
    onSuccess: (res) => {
      if (res.resolved === 1) message.success('已解决');
      else message.info('该告警已解决或不存在');
      void qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: () => message.error('解决失败'),
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
 * 通知联系人名册（change notification-contact-registry）：取联系人列表。
 * accountId 给定＝按账号；undefined＝全账号合并视图（每行带 accountId）。
 * 显式传 limit（默认取后端上限 1000）：全账号视图把上限从「每账号」抬到「合计」，避免默认 200 静默截断；
 * 页面据返回条数 == limit 判断是否触顶并诚实提示。
 */
export function useNotificationContacts(accountId: string | undefined, limit = 1000) {
  const qs = new URLSearchParams();
  if (accountId) qs.set('accountId', accountId);
  qs.set('limit', String(limit));
  return useQuery({
    queryKey: ['notification-contacts', accountId ?? 'all', limit],
    queryFn: () =>
      apiGet<{ contacts: PanelNotificationContact[] }>(`/api/notification/contacts?${qs.toString()}`),
  });
}

/**
 * 精选内容池（change curated-content-admin-page）：分页只读。
 * accountId 给定＝按账号；undefined＝全账号合并视图（每行带 accountId，服务端分页+一致 total）。
 */
export interface CuratedFilters {
  contentType?: 'image_text' | 'video' | 'comment';
  admitReason?: string;
  limit?: number;
  offset?: number;
}

export function useCuratedContents(accountId: string | undefined, filters: CuratedFilters) {
  const qs = new URLSearchParams();
  if (accountId) qs.set('accountId', accountId);
  if (filters.contentType) qs.set('contentType', filters.contentType);
  if (filters.admitReason) qs.set('admitReason', filters.admitReason);
  if (filters.limit !== undefined) qs.set('limit', String(filters.limit));
  if (filters.offset !== undefined) qs.set('offset', String(filters.offset));
  return useQuery({
    queryKey: [
      'curated',
      'contents',
      accountId ?? 'all',
      filters.contentType ?? '',
      filters.admitReason ?? '',
      filters.limit ?? 50,
      filters.offset ?? 0,
    ],
    queryFn: () => apiGet<CuratedContentList>(`/api/curated/contents?${qs.toString()}`),
  });
}

/** 精选筛选面：驱动纳入原因下拉 + 清理前影响预览（accountId 给定＝按账号；undefined＝全账号合并统计）。 */
export function useCuratedFacets(accountId: string | undefined) {
  return useQuery({
    queryKey: ['curated', 'facets', accountId ?? 'all'],
    queryFn: () =>
      apiGet<CuratedFacets>(`/api/curated/facets${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
  });
}
