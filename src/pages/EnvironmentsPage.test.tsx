import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { EnvironmentsPage, ENVIRONMENT_LIFECYCLE_META, filterEnvironmentAssets } from './EnvironmentsPage';
import type { EnvironmentAssetView } from '../types/api';

const environment: EnvironmentAssetView = {
  envKey: 'profile-001',
  environmentName: '上海运营环境',
  label: '上海运营环境',
  platform: 'xiaohongshu',
  assignees: [{ userId: 'client-1', name: '客户甲' }],
  assigneeCount: 1,
  cleanup: null,
  account: {
    accountId: 'account-001',
    label: '账号标签',
    nickname: '小红书真名',
    operatorAlias: null,
    displayName: '小红书真名',
    platform: 'xiaohongshu',
    groupLabel: '华东组',
    riskStatus: 'restricted',
    riskQuotaLevel: 'conservative',
  },
  bindingObservedAt: Date.now(),
  installation: { installationId: 'installation-1', lastSeenAt: Date.now(), online: true },
  lifecycle: { state: 'active', requestId: null, requestedBy: null, requestedAt: null,
    resultKind: null, resultError: null, resultAt: null, deletedAt: null },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EnvironmentsPage', () => {
  it('keeps historical deletion lifecycle labels read-only and stopped', () => {
    expect(ENVIRONMENT_LIFECYCLE_META.waiting_edge.text).toBe('历史删除请求（已停止）');
    expect(ENVIRONMENT_LIFECYCLE_META.deleting.text).toBe('历史删除状态（已停止）');
    expect(ENVIRONMENT_LIFECYCLE_META.deleted.text).toBe('已删除');
  });

  it('defaults to current assets and can filter deleted history by platform, account, group and assignee', () => {
    const deleted = {
      ...environment,
      envKey: 'profile-deleted',
      lifecycle: { ...environment.lifecycle, state: 'deleted' as const, deletedAt: Date.now() },
    };
    expect(filterEnvironmentAssets([environment, deleted], {
      lifecycle: 'current', platform: 'all', account: 'all', risk: 'all', group: 'all', assignee: 'all',
    }).map((item) => item.envKey)).toEqual(['profile-001']);
    expect(filterEnvironmentAssets([environment, deleted], {
      lifecycle: 'deleted', platform: 'xiaohongshu', account: 'account-001', risk: 'restricted',
      group: '华东组', assignee: 'client-1',
    }).map((item) => item.envKey)).toEqual(['profile-deleted']);
  });

  it('shows environment assets without any delete action or write request', async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => nativeGetComputedStyle(element));
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      environments: [environment], asOf: Date.now(),
    }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><App><EnvironmentsPage /></App></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('上海运营环境')).toBeTruthy();
    expect(screen.getByText('小红书真名')).toBeTruthy();
    expect(screen.getByText('华东组')).toBeTruthy();
    expect(screen.getByText('受限')).toBeTruthy();
    expect(screen.getByText('只读展示环境资产及历史状态')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /删除|重试删除|确认删除环境/ })).toBeNull();
    expect(screen.queryByLabelText('确认环境 ID')).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== 'POST')).toBe(true);
  });

});
