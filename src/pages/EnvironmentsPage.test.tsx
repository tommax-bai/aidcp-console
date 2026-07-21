import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('keeps legacy and direct-delete lifecycle labels explicit', () => {
    expect(ENVIRONMENT_LIFECYCLE_META.waiting_edge.text).toBe('旧删除请求，需重试');
    expect(ENVIRONMENT_LIFECYCLE_META.deleting.text).toBe('正在从 AdsPower 删除');
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

  it('shows mounted account/risk/group and requires exact envKey before Cloud direct deletion', async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => nativeGetComputedStyle(element));
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ deletion: {
          requestId: 'request-1', version: 1, envKey: environment.envKey, platform: environment.platform,
          targetUserId: 'client-1', state: 'deleted', resultKind: 'deleted', idempotent: false,
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ environments: [environment], asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App><EnvironmentsPage /></App>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('上海运营环境')).toBeTruthy();
    expect(screen.getByText('小红书真名')).toBeTruthy();
    expect(screen.getByText('华东组')).toBeTruthy();
    expect(screen.getByText('受限')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));

    const confirmButton = await screen.findByRole('button', { name: /确\s*认\s*删\s*除\s*环\s*境/ });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('确认环境 ID'), { target: { value: 'profile-00' } });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('确认环境 ID'), { target: { value: environment.envKey } });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(String(post?.[0])).toBe('/api/environments/profile-001/deletion');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ confirmEnvKey: 'profile-001' });
    expect(await screen.findByText('AdsPower 已删除，AIDCP 环境已移除')).toBeTruthy();
  });

  it('keeps the environment visible and shows a plain failure when AdsPower is unreachable', async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => nativeGetComputedStyle(element));
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'adspower_unreachable' }), {
          status: 502, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [environment], asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><App><EnvironmentsPage /></App></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('上海运营环境')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    fireEvent.change(await screen.findByLabelText('确认环境 ID'), { target: { value: environment.envKey } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*认\s*删\s*除\s*环\s*境/ }));
    expect(await screen.findByText('Cloud 无法连接 AdsPower API，AIDCP 环境已保留')).toBeTruthy();
    expect(screen.getAllByText('上海运营环境').length).toBeGreaterThan(0);
  });
});
