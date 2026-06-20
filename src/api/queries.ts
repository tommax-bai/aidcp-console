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
} from '../types/api';

export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => apiGet<VersionPayload>('/api/version'),
    staleTime: 60_000,
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

export function usePublished() {
  return useQuery({
    queryKey: ['content', 'published'],
    queryFn: () => apiGet<{ items: PanelPublish[] }>('/api/content/published'),
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
