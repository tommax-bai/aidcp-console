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
    expect(screen.getByText('环境资产与环境级运行配置')).toBeTruthy();
    expect(screen.getAllByText('不适用').length).toBeGreaterThanOrEqual(2);
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

  it('writes rule mode and comment approval by environment without optimistic state', async () => {
    let ruleEnabled = false;
    let commentMode: 'source_rules' | 'auto_approve_all' = 'source_rules';
    let commentConfigured = false;
    let releaseRuleWrite: (() => void) | undefined;
    let releaseCommentWrite: (() => void) | undefined;
    const facebook = {
      ...environment,
      envKey: 'facebook-policy',
      environmentName: 'Facebook 策略环境',
      platform: 'facebook',
      account: null,
      executionBinding: { state: 'unbound' as const, accountId: null },
      slowStart: { enabled: false, since: null, globallyDisabled: false },
    };
    const row = () => ({
      ...facebook,
      facebookRuleMode: {
        envKey: facebook.envKey,
        enabled: ruleEnabled,
        definitionId: 'facebook_browse_5_like_1_join_contact_every_2',
        definitionVersion: 2,
        definitionMismatch: false,
        updatedAt: ruleEnabled ? '2026-07-30T06:00:00.000Z' : null,
        updatedBy: ruleEnabled ? 'panel:alice' : null,
      },
      commentApproval: {
        envKey: facebook.envKey,
        mode: commentMode,
        configured: commentConfigured,
        updatedBy: commentConfigured ? 'panel:alice' : null,
        updatedAt: commentConfigured ? 1_775_000_000_000 : null,
        boundAccountId: null,
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'PUT' && path.includes('/facebook-rule-mode')) {
        return new Promise<Response>((resolve) => {
          releaseRuleWrite = () => {
            ruleEnabled = true;
            resolve(new Response(JSON.stringify({
              envKey: facebook.envKey,
              facebookRuleMode: row().facebookRuleMode,
            }), { status: 200, headers: { 'content-type': 'application/json' } }));
          };
        });
      }
      if (init?.method === 'PUT' && path.includes('/comment-approval')) {
        return new Promise<Response>((resolve) => {
          releaseCommentWrite = () => {
            commentMode = 'auto_approve_all';
            commentConfigured = true;
            resolve(new Response(JSON.stringify({
              envKey: facebook.envKey,
              commentApproval: row().commentApproval,
            }), { status: 200, headers: { 'content-type': 'application/json' } }));
          };
        });
      }
      return new Response(JSON.stringify({ environments: [row()], asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    const ruleSwitch = await screen.findByRole('switch', { name: '规则模式 facebook-policy' });
    expect(ruleSwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(ruleSwitch);
    expect(await screen.findByText('正在开启')).toBeTruthy();
    expect(ruleSwitch.getAttribute('aria-checked')).toBe('false');
    releaseRuleWrite?.();
    await waitFor(() => expect(ruleSwitch.getAttribute('aria-checked')).toBe('true'));

    const approvalSelect = screen.getByRole('combobox', { name: '评论审批 facebook-policy' });
    const selectedApprovalText = () =>
      approvalSelect.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent;
    expect(selectedApprovalText()).toBe('按来源规则');
    fireEvent.mouseDown(approvalSelect);
    fireEvent.click(await screen.findByText('全局免审', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(releaseCommentWrite).toBeTypeOf('function'));
    expect(selectedApprovalText()).toBe('按来源规则');
    releaseCommentWrite?.();
    await waitFor(() => expect(selectedApprovalText()).toBe('全局免审'));
    expect(screen.getAllByText('已保存，当前没有执行对象').length).toBeGreaterThanOrEqual(1);

    const writes = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      .map(([input, init]) => ({
        path: String(input),
        body: JSON.parse(String((init as RequestInit).body)),
      }));
    expect(writes.some(({ path, body }) =>
      path.includes('/api/environments/facebook-policy/facebook-rule-mode')
      && body.enabled === true
      && Object.keys(body).length === 1)).toBe(true);
    expect(writes.some(({ path, body }) =>
      path.includes('/api/environments/facebook-policy/comment-approval')
      && body.mode === 'auto_approve_all'
      && Object.keys(body).length === 1)).toBe(true);
    expect(writes.every(({ body }) => !Object.prototype.hasOwnProperty.call(body, 'accountId'))).toBe(true);
  });

  it('keeps environment policy truth on failure and does not expose a non-Facebook rule switch', async () => {
    const rows: EnvironmentAssetView[] = [
      {
        ...environment,
        envKey: 'facebook-rule-failure',
        platform: 'facebook',
        executionBinding: { state: 'unbound', accountId: null },
        slowStart: { enabled: false, since: null, globallyDisabled: false },
        facebookRuleMode: {
          envKey: 'facebook-rule-failure',
          enabled: false,
          definitionId: 'facebook_browse_5_like_1_join_contact_every_2',
          definitionVersion: 2,
          definitionMismatch: false,
          updatedAt: null,
          updatedBy: null,
        },
        commentApproval: {
          envKey: 'facebook-rule-failure',
          mode: 'source_rules',
          configured: false,
          updatedBy: null,
          updatedAt: null,
          boundAccountId: null,
        },
      },
      {
        ...environment,
        envKey: 'wechat-rule-none',
        platform: 'wechat_channels',
      },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'unsupported_platform' }), {
          status: 409, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: rows, asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    const toggle = await screen.findByRole('switch', { name: '规则模式 facebook-rule-failure' });
    fireEvent.click(toggle);
    expect(await screen.findByText('环境规则模式保存失败，原配置未改变')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('switch', { name: '规则模式 wechat-rule-none' })).toBeNull();

    const approvalSelect = screen.getByRole('combobox', { name: '评论审批 facebook-rule-failure' });
    const selectedApprovalText = () =>
      approvalSelect.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent;
    fireEvent.mouseDown(approvalSelect);
    fireEvent.click(await screen.findByText('全局免审', { selector: '.ant-select-item-option-content' }));
    expect(await screen.findByText('环境评论审批保存失败，原配置未改变')).toBeTruthy();
    expect(selectedApprovalText()).toBe('按来源规则');
  });

  it('uses the current environment binding and exposes a stored rule definition mismatch', async () => {
    const facebook: EnvironmentAssetView = {
      ...environment,
      envKey: 'facebook-rebound',
      platform: 'facebook',
      account: {
        ...environment.account!,
        accountId: 'account-new',
        displayName: '当前新账号',
        platform: 'facebook',
      },
      executionBinding: { state: 'bound', accountId: 'account-new' },
      slowStart: { enabled: false, since: null, globallyDisabled: false },
      facebookRuleMode: {
        envKey: 'facebook-rebound',
        enabled: true,
        definitionId: 'facebook_browse_10_like_1_join_contact_1',
        definitionVersion: 1,
        definitionMismatch: true,
        updatedAt: '2026-07-30T06:00:00.000Z',
        updatedBy: 'panel:old-operator',
      },
      commentApproval: {
        envKey: 'facebook-rebound',
        mode: 'auto_approve_all',
        configured: true,
        updatedBy: 'panel:old-operator',
        updatedAt: 1_775_000_000_000,
        boundAccountId: 'account-new',
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      environments: [facebook], asOf: Date.now(),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderPage(fetchMock);

    expect((await screen.findAllByText(/由当前挂载账号 当前新账号 执行/)).length).toBe(2);
    expect(screen.queryByText(/旧账号.*执行/)).toBeNull();
    expect(screen.getByText(/库存定义：facebook_browse_10_like_1_join_contact_1@1，.*仅允许关闭以修复定义/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: '规则模式 facebook-rebound' }).hasAttribute('disabled')).toBe(false);
  });

  it('does not claim a rule executor when the binding is conflicted', async () => {
    const facebook: EnvironmentAssetView = {
      ...environment,
      envKey: 'facebook-conflict',
      platform: 'facebook',
      account: {
        ...environment.account!,
        accountId: 'account-contended',
        displayName: '争用账号',
        platform: 'facebook',
      },
      executionBinding: { state: 'binding_conflict', accountId: null },
      slowStart: { enabled: false, since: null, globallyDisabled: false },
      facebookRuleMode: {
        envKey: 'facebook-conflict',
        enabled: true,
        definitionId: 'facebook_browse_5_like_1_join_contact_every_2',
        definitionVersion: 2,
        definitionMismatch: false,
        updatedAt: '2026-07-30T06:00:00.000Z',
        updatedBy: 'panel:alice',
      },
      commentApproval: {
        envKey: 'facebook-conflict',
        mode: 'source_rules',
        configured: false,
        updatedBy: null,
        updatedAt: null,
        boundAccountId: null,
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      environments: [facebook], asOf: Date.now(),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderPage(fetchMock);

    expect(await screen.findByText('绑定冲突，规则模式当前不执行')).toBeTruthy();
    expect(screen.queryByText(/由当前挂载账号 争用账号 执行/)).toBeNull();
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
    expect(screen.getAllByText('不适用').length).toBeGreaterThanOrEqual(2);
  });

});
