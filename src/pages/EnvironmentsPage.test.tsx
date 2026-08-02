import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { EnvironmentsPage, ENVIRONMENT_LIFECYCLE_META, filterEnvironmentAssets } from './EnvironmentsPage';
import type {
  EnvironmentAssetView,
  FacebookGroupCommentPolicyView,
  FacebookOperationGlobalPolicyView,
  FacebookOperationPolicyView,
} from '../types/api';

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

const facebookEnvironment: EnvironmentAssetView = {
  ...environment,
  envKey: 'facebook-001',
  environmentName: 'Facebook 新环境',
  platform: 'facebook',
  account: null,
};

const operationPolicy: FacebookOperationPolicyView = {
  envKey: facebookEnvironment.envKey,
  baseMode: 'rule',
  effectiveMode: null,
  policyRevision: 3,
  schemaVersion: 'facebook-operation-policy/v1',
  cadenceSource: 'environment',
  rule: { viewsPerLike: 5, joinEveryNRounds: 2 },
  consumption: {
    viewsPerLike: 5,
    confirmedLikesPerJoin: 2,
    confirmedJoinsPerComment: 2,
  },
  bounds: {
    rule: {
      viewsPerLike: { min: 1, max: 100, default: 5 },
      joinEveryNRounds: { min: 1, max: 20, default: 2 },
    },
    consumption: {
      viewsPerLike: { min: 1, max: 100, default: 5 },
      confirmedLikesPerJoin: { min: 1, max: 20, default: 2 },
      confirmedJoinsPerComment: { min: 1, max: 20, default: 2 },
    },
  },
  slowStart: { state: 'off', since: null, globallyDisabled: false },
  binding: {
    state: 'unbound',
    accountId: null,
    accountDisplayName: null,
  },
  blocker: null,
  updatedAt: '2026-07-30T01:00:00.000Z',
  updatedBy: 'panel:alice',
};

const globalPolicy: FacebookOperationGlobalPolicyView = {
  executionTarget: 'dev',
  revision: 8,
  schemaVersion: 'facebook_operation_global_policy@3',
  rule: { viewsPerLike: 5, joinEveryNRounds: 2 },
  consumption: {
    viewsPerLike: 5,
    confirmedLikesPerJoin: 2,
    confirmedJoinsPerComment: 2,
  },
  reels: {
    persona: { viewsPerLike: 4, viewsPerFollow: 10 },
    slowStart: { viewsPerLike: 15, viewsPerFollow: 15 },
    rule: { viewsPerFollow: 15 },
    consumption: { viewsPerFollow: 15 },
  },
  slowStart: {
    totalDays: 7,
    dailyCaps: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      view: 30 + index * 10,
      like: 2 + index,
      comment: index,
      follow: 1 + index,
      publish: index === 6 ? 1 : 0,
      search: 2 + index,
      joinGroup: index === 6 ? 1 : 0,
    })),
  },
  bounds: {
    rule: {
      viewsPerLike: { min: 1, max: 100, default: 5 },
      joinEveryNRounds: { min: 1, max: 20, default: 2 },
    },
    consumption: {
      viewsPerLike: { min: 1, max: 100, default: 5 },
      confirmedLikesPerJoin: { min: 1, max: 20, default: 2 },
      confirmedJoinsPerComment: { min: 1, max: 20, default: 2 },
    },
    reels: {
      persona: {
        viewsPerLike: { min: 1, max: 100, default: 4 },
        viewsPerFollow: { min: 1, max: 100, default: 10 },
      },
      slowStart: {
        viewsPerLike: { min: 1, max: 100, default: 15 },
        viewsPerFollow: { min: 1, max: 100, default: 15 },
      },
      rule: { viewsPerFollow: { min: 1, max: 100, default: 15 } },
      consumption: { viewsPerFollow: { min: 1, max: 100, default: 15 } },
    },
    slowStart: {
      totalDays: { min: 1, max: 30, default: 7 },
      dailyCaps: {
        view: { min: 0, max: 1_000 },
        like: { min: 0, max: 100 },
        comment: { min: 0, max: 100 },
        follow: { min: 0, max: 100 },
        publish: { min: 0, max: 100 },
        search: { min: 0, max: 100 },
        joinGroup: { min: 0, max: 100 },
      },
    },
  },
  updatedAt: '2026-07-30T01:00:00.000Z',
  updatedBy: 'panel:alice',
};

const groupCommentPolicy: FacebookGroupCommentPolicyView = {
  joinToFirstCommentHours: 24,
  revision: null,
  source: 'default',
  bounds: {
    joinToFirstCommentHours: { min: 1, max: 168, default: 24 },
  },
  sameGroupRecommentCooldownHours: 72,
  sameGroupRecommentCooldownSource: 'default',
  updatedAt: null,
  updatedBy: null,
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

  it('shows non-Facebook environment assets without a Facebook policy or delete write action', async () => {
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
    expect(screen.getByText('环境资产、Facebook 运行策略与评论审批')).toBeTruthy();
    expect(screen.getByText('不适用')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /编辑运行策略/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除|重试删除|确认删除环境/ })).toBeNull();
    expect(screen.queryByLabelText('确认环境 ID')).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => !['POST', 'PUT'].includes((init as RequestInit | undefined)?.method ?? 'GET'))).toBe(true);
  });

  it('edits slow-start Reel like/follow cadence with the other target-global values in one CAS write', async () => {
    let currentGlobal = globalPolicy;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/facebook/groups/comment-policy')) {
        return new Response(JSON.stringify(groupCommentPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/api/facebook/operation-global-policy')) {
        if (init?.method === 'PUT') {
          const inputPolicy = JSON.parse(String(init.body));
          currentGlobal = {
            ...globalPolicy,
            ...inputPolicy,
            revision: 9,
            updatedAt: '2026-07-31T01:00:00.000Z',
          };
        }
        return new Response(JSON.stringify(currentGlobal), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [environment], asOf: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByRole('region', { name: 'Facebook 全局运行数值摘要' })).toBeTruthy();
    expect(screen.getByText('DEV')).toBeTruthy();
    expect(screen.getByText('分天动作上限')).toBeTruthy();
    expect(screen.getByText('Reel 节奏')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑全局数值' }));
    expect(await screen.findByRole('region', { name: '普通人设 Reel 节奏' })).toBeTruthy();
    expect(screen.getByRole('table', { name: '冷启动每日动作上限' })).toBeTruthy();
    const slowStartReelLike = await screen.findByLabelText('冷启动 Reel 浏览点赞阈值');
    const saveGlobal = screen.getByRole('button', { name: '保存全局数值' });
    fireEvent.change(slowStartReelLike, { target: { value: '101' } });
    expect(saveGlobal.hasAttribute('disabled')).toBe(true);
    fireEvent.change(slowStartReelLike, {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText('冷启动 Reel 浏览关注阈值'), {
      target: { value: '16' },
    });
    fireEvent.change(await screen.findByLabelText('全局规则模式浏览点赞阈值'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText('全局冷启动总天数'), {
      target: { value: '8' },
    });
    expect(await screen.findByLabelText('冷启动第8天浏览上限')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存全局数值' }));

    await waitFor(() => expect(screen.getByText('revision 9')).toBeTruthy());
    const put = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/facebook/operation-global-policy')
        && (init as RequestInit | undefined)?.method === 'PUT',
    );
    const body = JSON.parse(String((put?.[1] as RequestInit).body));
    expect(body.expectedRevision).toBe(8);
    expect(body.reels).toEqual({
      ...globalPolicy.reels,
      slowStart: { viewsPerLike: 12, viewsPerFollow: 16 },
    });
    expect(body.rule.viewsPerLike).toBe(6);
    expect(body.consumption).toEqual(globalPolicy.consumption);
    expect(body.slowStart.totalDays).toBe(8);
    expect(body.slowStart.dailyCaps).toHaveLength(8);
    expect(body.slowStart.dailyCaps[7]).toEqual({
      ...globalPolicy.slowStart.dailyCaps[6],
      day: 8,
    });
    const authoritativeReads = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).endsWith('/api/facebook/operation-global-policy')
        && (init as RequestInit | undefined)?.method !== 'PUT',
    );
    expect(authoritativeReads.length).toBeGreaterThanOrEqual(2);
  });

  it('edits join-to-first-comment delay inside global configuration with its own CAS write', async () => {
    let currentGroupPolicy = groupCommentPolicy;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/facebook/groups/comment-policy')) {
        if (init?.method === 'PUT') {
          const inputPolicy = JSON.parse(String(init.body));
          currentGroupPolicy = {
            ...currentGroupPolicy,
            joinToFirstCommentHours: inputPolicy.joinToFirstCommentHours,
            revision: 1,
            source: 'db',
            updatedAt: '2026-08-03T01:00:00.000Z',
            updatedBy: 'panel:alice',
          };
        }
        return new Response(JSON.stringify(currentGroupPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/api/facebook/operation-global-policy')) {
        return new Response(JSON.stringify(globalPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/api/environments/facebook-001/facebook-operation-policy')) {
        return new Response(JSON.stringify(operationPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [facebookEnvironment], asOf: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    await screen.findByRole('region', { name: 'Facebook 全局运行数值摘要' });
    expect(screen.queryByLabelText('入群后首次评论等待（小时）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑全局数值' }));

    expect(await screen.findByText('入群后评论延迟（独立保存）')).toBeTruthy();
    expect(await screen.findByText('同群再次评论冷却（独立，只读）')).toBeTruthy();
    expect(screen.getByText('72 小时')).toBeTruthy();
    const delay = screen.getByLabelText('入群后首次评论等待（小时）') as HTMLInputElement;
    expect(delay.value).toBe('24');
    fireEvent.change(delay, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '保存首次评论等待' }));

    await waitFor(() => expect(screen.getByText('revision 1')).toBeTruthy());
    const groupPut = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/facebook/groups/comment-policy')
        && (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse(String((groupPut?.[1] as RequestInit).body))).toEqual({
      expectedRevision: 0,
      joinToFirstCommentHours: 12,
    });
    expect(fetchMock.mock.calls.some(
      ([input, init]) => String(input).endsWith('/api/facebook/operation-global-policy')
        && (init as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('keeps the edited global Reel cadence after a stale CAS failure', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/facebook/groups/comment-policy')) {
        return new Response(JSON.stringify(groupCommentPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/api/facebook/operation-global-policy')) {
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({
            error: 'revision_conflict',
            current: { ...globalPolicy, revision: 9 },
          }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(globalPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [environment], asOf: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    await screen.findByRole('region', { name: 'Facebook 全局运行数值摘要' });
    fireEvent.click(screen.getByRole('button', { name: '编辑全局数值' }));
    const slowStartLikeInput = await screen.findByLabelText('冷启动 Reel 浏览点赞阈值') as HTMLInputElement;
    fireEvent.change(slowStartLikeInput, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '保存全局数值' }));

    expect(await screen.findByText('全局策略已被其他操作员更新；当前表单已保留，请重新读取。')).toBeTruthy();
    expect(slowStartLikeInput.value).toBe('12');
  });

  it('saves an inheriting environment without sending duplicated cadence values', async () => {
    let current = { ...operationPolicy, cadenceSource: 'global' as const };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/facebook/operation-global-policy')) {
        return new Response(JSON.stringify(globalPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/api/environments/facebook-001/facebook-operation-policy')) {
        if (init?.method === 'PUT') {
          current = {
            ...current,
            baseMode: 'consumption',
            policyRevision: 4,
          };
        }
        return new Response(JSON.stringify(current), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [facebookEnvironment], asOf: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('节奏：继承全局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑运行策略 facebook-001' }));
    expect(await screen.findByText('当前环境继承全局数值')).toBeTruthy();
    expect(screen.queryByLabelText('规则模式浏览点赞阈值 facebook-001')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '运行模式 facebook-001' }));
    fireEvent.click(await screen.findByText('消费模式', { selector: '.ant-select-item-option-content' }));
    fireEvent.click(screen.getByRole('button', { name: '保存运行策略' }));

    await waitFor(() => expect(screen.getByText('基础：消费模式')).toBeTruthy());
    const put = fetchMock.mock.calls.find(
      ([input, init]) => String(input).includes('/facebook-001/facebook-operation-policy')
        && (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      expectedRevision: 3,
      mode: 'consumption',
      cadenceSource: 'global',
    });
  });

  it('blocks no-op saves, then re-baselines after a confirmed CAS write and refetch', async () => {
    let currentPolicy = operationPolicy;
    let releaseWrite: (() => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/environments/facebook-001/facebook-operation-policy')
        && init?.method === 'PUT') {
        return new Promise<Response>((resolve) => {
          releaseWrite = () => {
            currentPolicy = {
              ...operationPolicy,
              baseMode: 'consumption',
              policyRevision: 4,
              consumption: {
                viewsPerLike: 6,
                confirmedLikesPerJoin: 3,
                confirmedJoinsPerComment: 4,
              },
            };
            resolve(new Response(JSON.stringify(currentPolicy), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }));
          };
        });
      }
      if (path.endsWith('/api/environments/facebook-001/facebook-operation-policy')) {
        return new Response(JSON.stringify(currentPolicy), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ environments: [facebookEnvironment], asOf: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('基础：规则模式')).toBeTruthy();
    expect(screen.getByText('生效：无执行对象')).toBeTruthy();
    expect(screen.getByText('未挂载（可配置）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑运行策略 facebook-001' }));
    expect(await screen.findByLabelText('规则模式浏览点赞阈值 facebook-001')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存运行策略' }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '保存运行策略' }));
    expect(fetchMock.mock.calls.some(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '运行模式 facebook-001' }));
    fireEvent.click(await screen.findByText('消费模式', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByText('加群与评论是两个独立阶段')).toBeTruthy();
    expect(screen.getByText(/加群阶段只加入群组、不发评论/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('消费模式浏览点赞阈值 facebook-001'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText('消费模式确认点赞加群阈值 facebook-001'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('消费模式确认加群评论阈值 facebook-001'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存运行策略' }));

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(true));
    expect(screen.getByText('基础：规则模式')).toBeTruthy();
    releaseWrite?.();
    expect(await screen.findByText('基础：消费模式')).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(String(put?.[0])).toContain('/api/environments/facebook-001/facebook-operation-policy');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      expectedRevision: 3,
      mode: 'consumption',
      cadenceSource: 'environment',
      rule: { viewsPerLike: 5, joinEveryNRounds: 2 },
      consumption: {
        viewsPerLike: 6,
        confirmedLikesPerJoin: 3,
        confirmedJoinsPerComment: 4,
      },
    });
    await waitFor(() =>
      expect(screen.queryByLabelText('消费模式浏览点赞阈值 facebook-001')).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑运行策略 facebook-001' }));
    expect(await screen.findByLabelText('消费模式浏览点赞阈值 facebook-001')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存运行策略' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    )).toHaveLength(1);
  });

  it('keeps the edited cadence after a stale CAS failure', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'revision_conflict' }), {
          status: 409, headers: { 'content-type': 'application/json' },
        });
      }
      const body = path.endsWith('/facebook-operation-policy')
        ? operationPolicy
        : { environments: [facebookEnvironment], asOf: Date.now() };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: '编辑运行策略 facebook-001' }));
    fireEvent.change(screen.getByLabelText('规则模式浏览点赞阈值 facebook-001'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存运行策略' }));

    expect(await screen.findByText(/策略已被其他操作员更新/)).toBeTruthy();
    expect((screen.getByLabelText('规则模式浏览点赞阈值 facebook-001') as HTMLInputElement).value).toBe('7');
    expect(screen.getByText('基础：规则模式')).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      expectedRevision: 3,
      mode: 'rule',
      cadenceSource: 'environment',
      rule: { viewsPerLike: 7, joinEveryNRounds: 2 },
      consumption: {
        viewsPerLike: 5,
        confirmedLikesPerJoin: 2,
        confirmedJoinsPerComment: 2,
      },
    });
  });

  it('keeps comment approval non-optimistic beside the unified operation policy', async () => {
    let commentMode: 'source_rules' | 'auto_approve_all' = 'source_rules';
    let commentConfigured = false;
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
        enabled: false,
        definitionId: 'facebook_browse_5_like_1_join_contact_every_2',
        definitionVersion: 2,
        definitionMismatch: false,
        updatedAt: null,
        updatedBy: null,
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
      if (path.endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({
          ...operationPolicy,
          envKey: facebook.envKey,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ environments: [row()], asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByRole('button', { name: '编辑运行策略 facebook-policy' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /规则模式 facebook-policy/ })).toBeNull();
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
      path.includes('/api/environments/facebook-policy/comment-approval')
      && body.mode === 'auto_approve_all'
      && Object.keys(body).length === 1)).toBe(true);
    expect(writes.some(({ path }) => path.includes('/facebook-rule-mode'))).toBe(false);
    expect(writes.every(({ body }) => !Object.prototype.hasOwnProperty.call(body, 'accountId'))).toBe(true);
  });

  it('keeps comment approval truth on failure and exposes no legacy rule switch', async () => {
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'unsupported_platform' }), {
          status: 409, headers: { 'content-type': 'application/json' },
        });
      }
      if (String(input).endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({
          ...operationPolicy,
          envKey: 'facebook-rule-failure',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ environments: rows, asOf: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByRole('button', { name: '编辑运行策略 facebook-rule-failure' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /规则模式/ })).toBeNull();
    const approvalSelect = screen.getByRole('combobox', { name: '评论审批 facebook-rule-failure' });
    const selectedApprovalText = () =>
      approvalSelect.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent;
    fireEvent.mouseDown(approvalSelect);
    fireEvent.click(await screen.findByText('全局免审', { selector: '.ant-select-item-option-content' }));
    expect(await screen.findByText('环境评论审批保存失败，原配置未改变')).toBeTruthy();
    expect(selectedApprovalText()).toBe('按来源规则');
  });

  it('uses the current operation-policy binding and exposes its named blocker', async () => {
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({
          ...operationPolicy,
          envKey: facebook.envKey,
          effectiveMode: 'rule',
          binding: {
            state: 'bound',
            accountId: 'account-new',
            accountDisplayName: '当前新账号',
          },
          blocker: 'rule_definition_mismatch',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        environments: [facebook], asOf: Date.now(),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('挂载：当前新账号')).toBeTruthy();
    expect(screen.getByText(/由当前挂载账号 当前新账号 执行/)).toBeTruthy();
    expect(screen.queryByText(/旧账号.*执行/)).toBeNull();
    expect(screen.getByText('阻断：rule_definition_mismatch')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /规则模式/ })).toBeNull();
  });

  it('projects a conflicted operation-policy binding without claiming an executor', async () => {
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({
          ...operationPolicy,
          envKey: facebook.envKey,
          effectiveMode: 'blocked',
          binding: {
            state: 'conflict',
            accountId: null,
            accountDisplayName: null,
          },
          blocker: 'operation_environment_binding_conflict',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        environments: [facebook], asOf: Date.now(),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('生效：已阻断')).toBeTruthy();
    expect(screen.getByText('挂载状态：conflict')).toBeTruthy();
    expect(screen.getByText('阻断：operation_environment_binding_conflict')).toBeTruthy();
    expect(screen.queryByText(/由当前挂载账号 争用账号 执行/)).toBeNull();
    expect(screen.queryByRole('switch', { name: /规则模式/ })).toBeNull();
  });

  it('shows globally-disabled slow-start truth in the unified policy and no legacy switches', async () => {
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({
          ...operationPolicy,
          envKey: 'facebook-disabled',
          slowStart: {
            state: 'off',
            since: null,
            globallyDisabled: true,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        environments: rows, asOf: Date.now(),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('慢启动：Cloud 全局停用')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /慢启动/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /规则模式/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑运行策略 wechat-001' })).toBeNull();
  });

  it('keeps an independent cadence payload while switching to persona', async () => {
    let current = operationPolicy;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'PUT') {
        current = { ...operationPolicy, baseMode: 'persona', policyRevision: 4 };
        return new Response(JSON.stringify(current), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      const body = path.endsWith('/facebook-operation-policy')
        ? current
        : { environments: [facebookEnvironment], asOf: Date.now() };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: '编辑运行策略 facebook-001' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '运行模式 facebook-001' }));
    fireEvent.click(await screen.findByText('人设模式', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByLabelText(/规则模式浏览点赞阈值/)).toBeTruthy();
    expect(screen.getByLabelText(/消费模式浏览点赞阈值/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存运行策略' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        expectedRevision: 3,
        mode: 'persona',
        cadenceSource: 'environment',
        rule: { viewsPerLike: 5, joinEveryNRounds: 2 },
        consumption: {
          viewsPerLike: 5,
          confirmedLikesPerJoin: 2,
          confirmedJoinsPerComment: 2,
        },
      });
    });
  });

  it('uses server bounds to block an invalid consumption cadence before PUT', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        throw new Error('unexpected PUT');
      }
      const body = String(input).endsWith('/facebook-operation-policy')
        ? operationPolicy
        : { environments: [facebookEnvironment], asOf: Date.now() };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: '编辑运行策略 facebook-001' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '运行模式 facebook-001' }));
    fireEvent.click(await screen.findByText('消费模式', { selector: '.ant-select-item-option-content' }));
    const input = screen.getByLabelText('消费模式浏览点赞阈值 facebook-001');
    fireEvent.change(input, { target: { value: '101' } });
    await waitFor(() =>
      expect(screen.getByText('浏览点赞阈值必须在 1–100 之间')).toBeTruthy(),
    );
    expect((screen.getByRole('button', { name: '保存运行策略' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'))
      .toBe(false);
  });

  it('projects active slow start through the unified policy and has no second slow-start switch', async () => {
    const current = {
      ...operationPolicy,
      effectiveMode: 'slow_start' as const,
      slowStart: {
        state: 'active' as const,
        since: 1_774_800_000_000,
        globallyDisabled: false,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      const body = path.endsWith('/facebook-operation-policy')
        ? current
        : { environments: [facebookEnvironment], asOf: Date.now() };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('基础：规则模式')).toBeTruthy();
    expect(screen.getByText('生效：慢启动')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /慢启动/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑运行策略 facebook-001' }));
    expect(screen.getByText(/启用现有慢启动生命周期/)).toBeTruthy();
    const save = screen.getByRole('button', { name: '保存运行策略' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'))
      .toBe(false);
  });

  it('keeps unbound active slow start selected without fabricating an execution mode', async () => {
    const current = {
      ...operationPolicy,
      baseMode: 'persona' as const,
      effectiveMode: null,
      slowStart: {
        state: 'active' as const,
        since: 1_774_800_000_000,
        globallyDisabled: false,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/facebook-operation-policy')
        ? current
        : { environments: [facebookEnvironment], asOf: Date.now() };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('基础：人设模式')).toBeTruthy();
    expect(screen.getByText('生效：无执行对象')).toBeTruthy();
    expect(screen.getByText('慢启动生命周期已启用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑运行策略 facebook-001' }));
    expect(screen.getByText('慢启动', { selector: '.ant-select-selection-item' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存运行策略' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('renders unavailable policy truth without guessing persona mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/facebook-operation-policy')) {
        return new Response(JSON.stringify({ error: 'unavailable' }), {
          status: 503, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        environments: [facebookEnvironment],
        asOf: Date.now(),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('策略状态未知')).toBeTruthy();
    expect(screen.queryByText('基础：人设模式')).toBeNull();
    expect(screen.getByRole('button', { name: '重试读取' })).toBeTruthy();
  });

});
