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
  slowStart: { enabled: false, since: null, globallyDisabled: false },
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

function installDomStubs() {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => nativeGetComputedStyle(element));
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })));
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  installDomStubs();
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><App><EnvironmentsPage /></App></MemoryRouter>
    </QueryClientProvider>,
  );
}

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

  it('shows non-Facebook environment assets without a slow-start or delete write action', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      environments: [environment], asOf: Date.now(),
    }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    renderPage(fetchMock);

    expect(await screen.findByText('上海运营环境')).toBeTruthy();
    expect(screen.getByText('小红书真名')).toBeTruthy();
    expect(screen.getByText('华东组')).toBeTruthy();
    expect(screen.getByText('受限')).toBeTruthy();
    expect(screen.getByText('环境资产与环境级慢启动配置')).toBeTruthy();
    expect(screen.getByText('不适用')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /慢启动/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除|重试删除|确认删除环境/ })).toBeNull();
    expect(screen.queryByLabelText('确认环境 ID')).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => !['POST', 'PUT'].includes((init as RequestInit | undefined)?.method ?? 'GET'))).toBe(true);
  });

  it('keeps the authoritative switch value during pending and converges to the Cloud write response', async () => {
    let enabled = false;
    let releaseWrite: (() => void) | undefined;
    const facebook = {
      ...environment,
      envKey: 'facebook-001',
      environmentName: 'Facebook 新环境',
      platform: 'facebook',
      account: null,
      slowStart: { enabled: false, since: null, globallyDisabled: false },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Promise<Response>((resolve) => {
          releaseWrite = () => {
            enabled = true;
            resolve(new Response(JSON.stringify({
              envKey: facebook.envKey,
              slowStart: { enabled: true, since: 1_774_800_000_000, globallyDisabled: false },
            }), { status: 200, headers: { 'content-type': 'application/json' } }));
          };
        });
      }
      expect(String(input)).toContain('/api/environments');
      return new Response(JSON.stringify({
        environments: [{
          ...facebook,
          slowStart: {
            enabled,
            since: enabled ? 1_774_800_000_000 : null,
            globallyDisabled: false,
          },
        }],
        asOf: Date.now(),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);

    const toggle = await screen.findByRole('switch', { name: '慢启动 facebook-001' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByText('正在开启')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    releaseWrite?.();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText('已保存，挂载账号后按曲线生效')).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(String(put?.[0])).toContain('/api/environments/facebook-001/slow-start');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ enabled: true });
  });

  it('keeps the original switch value on write failure', async () => {
    const facebook = {
      ...environment,
      envKey: 'facebook-failure',
      platform: 'facebook',
      slowStart: { enabled: false, since: null, globallyDisabled: false },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'platform_unsupported' }), {
          status: 409, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [facebook], asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    const toggle = await screen.findByRole('switch', { name: '慢启动 facebook-failure' });
    fireEvent.click(toggle);
    expect(await screen.findByText('环境慢启动保存失败，原配置未改变')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('shows saved-but-globally-disabled truth and withholds switches from unsupported rows', async () => {
    const rows: EnvironmentAssetView[] = [
      {
        ...environment,
        envKey: 'facebook-disabled',
        environmentName: 'Facebook 全局停用',
        platform: 'facebook',
        slowStart: { enabled: true, since: 1_774_800_000_000, globallyDisabled: true },
      },
      {
        ...environment,
        envKey: 'wechat-001',
        environmentName: '视频号环境',
        platform: 'wechat_channels',
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      environments: rows, asOf: Date.now(),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderPage(fetchMock);

    expect(await screen.findByText('已配置 · Cloud 全局停用')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '慢启动 facebook-disabled' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('switch', { name: '慢启动 wechat-001' })).toBeNull();
    expect(screen.getByText('不适用')).toBeTruthy();
  });

});
