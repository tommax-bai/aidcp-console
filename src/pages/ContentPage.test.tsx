/**
 * change console-cloud-panel-hardening #32：内容审批 CAS 链前端测试。
 * 只 mock HTTP 客户端层（apiGet/apiPost/apiPut），页面 + react-query 走真实渲染与调用路径；
 * 断言拒因经 errorText（#31）呈现为**说人话中文**、绝不把英文机器码（version_stale 等）直接上屏。
 *
 * 契约变更（source=console 直接确认入队）：候选稿动作单次创建即 queued + autoQueued，无「请确认用户委托任务」
 * 二次确认卡、无 /confirm 调用；CAS 版本（candidateVersion）随创建调用一同下发，版本冲突在创建调用本身以 409 诚实拒绝。
 *
 * 关键：mock 工厂经 vi.importActual 保留真实 ApiError 类，使 errorText 的 `err instanceof ApiError`
 * 与测试里 `new ApiError(...)` 命中同一个类（否则 instanceof 恒 false、拒因映射被跳过）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentPage, PublishQueuePage, visualCategoryPresentation } from './ContentPage';
import { ApiError, apiGet, apiPost, apiPut } from '../api/client';
import type {
  ContentQueue,
  ContentQueueJourney,
  ContentQueueStageState,
  DelegatedTaskDraftReceipt,
  DelegatedTaskView,
  PanelContentVisualCategoryBrief,
  PanelPublish,
} from '../types/api';

// jsdom 无 matchMedia / ResizeObserver；antd Table/Select/Drawer（rc-*）依赖，给最小桩。
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
if (typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  published: { items: [] as unknown[] },
  queue: { status: 'idle', snapshot: null } as ContentQueue,
  accounts: { accounts: [] as unknown[] },
  delegatedTasks: { tasks: [] as DelegatedTaskView[] },
  delegatedTasksError: null as Error | null,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual, // 保留真实 ApiError / UnauthorizedError，使 errorText 的 instanceof 命中同一类
    apiGet: vi.fn((path: string) => {
      if (path.startsWith('/api/accounts')) return Promise.resolve(state.accounts);
      if (path.startsWith('/api/content/published')) return Promise.resolve(state.published);
      if (path === '/api/content/queue') return Promise.resolve(state.queue);
      if (path.startsWith('/api/delegated-tasks')) {
        return state.delegatedTasksError ? Promise.reject(state.delegatedTasksError) : Promise.resolve(state.delegatedTasks);
      }
      return Promise.reject(new Error(`unexpected apiGet ${path}`));
    }),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
  };
});

function makePending(overrides: Partial<PanelPublish> = {}): PanelPublish {
  return {
    id: 1,
    title: '测试草稿标题',
    status: 'pending_approval',
    platform: 'xiaohongshu',
    platformPostId: null,
    publishedAt: new Date('2026-07-03T10:00:00').getTime(),
    publishMode: 'immediate',
    publishTime: null,
    scheduledAt: null,
    scheduledPlatformId: null,
    accountId: 'acc-1',
    accountLabel: '测试账号',
    content: '正文内容',
    postUrl: null,
    contentVersion: 0,
    images: [],
    imageUrl: null,
    imagesAttachedCount: 0,
    imageReferenceAudit: null,
    sourceReference: null,
    ...overrides,
  };
}

const lifecycleStageLabels = ['触发与选题', '正文生成', '文本质检', '视觉策划', '出图复核', '成稿封装', '人工审批', '平台下发'] as const;
const lifecycleStageKeys = ['source', 'content', 'text_quality', 'visual_plan', 'image_review', 'package', 'approval', 'dispatch'] as const;

function journey(overrides: Partial<ContentQueueJourney> = {}, states: Partial<Record<(typeof lifecycleStageKeys)[number], ContentQueueStageState>> = {}): ContentQueueJourney {
  return {
    journeyId: 'run:r1',
    runId: 'r1',
    recordId: null,
    accountId: 'acc-1',
    title: '八阶段测试稿件',
    sourceTitle: null,
    kind: 'autonomous',
    startedAt: 100,
    active: true,
    status: 'generating',
    statusSummary: '正在生成候审稿',
    stages: lifecycleStageKeys.map((key, index) => ({
      key,
      label: lifecycleStageLabels[index],
      state: states[key] ?? (index < 2 ? 'completed' : index < 4 ? 'running' : 'pending'),
      summary: index < 2 ? '本阶段已完成' : index < 4 ? '本阶段进行中' : '等待上游',
      facts: key === 'image_review' ? ['有效图片 1 张'] : [],
    })),
    snapshot: { customDebug: { reason: 'lifecycle-raw' } },
    ...overrides,
  };
}

// console 精确入口（候选稿动作 source=console）现由云端直接确认入队：回执已是 queued + autoQueued，无二次确认卡。
// confirmation 字段仅为满足现有 DelegatedTaskDraftReceipt 类型保留（页面已不再读取/渲染它）。
function candidateTaskReceipt(action: string): DelegatedTaskDraftReceipt & { autoQueued: true } {
  return {
    created: true,
    autoQueued: true,
    task: {
      id: `task-${action}`, accountId: 'acc-1', accountName: '测试账号', platform: 'xiaohongshu', action,
      targetSuccessCount: 1, maxAttempts: 1, deadlineAt: Date.now() + 60_000, approvalMode: 'review', priority: 'normal',
      status: 'queued', progress: { successCount: 0, attemptCount: 0, skippedCount: 0, failureCount: 0 }, version: 4,
    },
    confirmation: {
      taskId: `task-${action}`, version: 4, title: '请确认用户委托任务', accountName: '测试账号', platformLabel: '小红书',
      actionLabel: action === 'approve_candidate' ? '批准候选稿' : action === 'reject_candidate' ? '驳回候选稿' : '修改候选稿',
      target: '1 个验证成功结果', attempts: '最多 1 次尝试', schedule: '确认后排队', approval: '公开写操作保留人审',
      priority: '普通', constraints: [], capability: 'supported',
    },
  };
}

function delegatedTask(overrides: Partial<DelegatedTaskView> = {}): DelegatedTaskView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: 'acc-1',
    accountName: '工程师大白',
    platform: 'xiaohongshu',
    action: 'publish_post',
    actionFamily: 'publish',
    targetSuccessCount: 1,
    maxAttempts: 2,
    deadlineAt: Date.now() + 86_400_000,
    sourceConstraints: { title: '排队来源标题' },
    approvalMode: 'review',
    priority: 'normal',
    status: 'queued',
    progress: { successCount: 0, attemptCount: 0, skippedCount: 0, failureCount: 0 },
    createdAt: new Date('2026-07-19T10:00:00+08:00').getTime(),
    version: 2,
    ...overrides,
  };
}

function renderSurface(surface: ReactNode, initialEntry = '/content'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[initialEntry]}>
            {surface}
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>,
  );
}

function renderPage(initialEntry = '/content'): void {
  renderSurface(<ContentPage />, initialEntry);
}

function renderQueuePage(): void {
  renderSurface(<PublishQueuePage />, '/publish-queue');
}

/** 渲染 → 等待待审行 → 点整行打开详情浮层（对齐精选页交互；保存草稿按钮出现即编辑态就绪）。 */
async function openEditDrawer(): Promise<void> {
  renderPage();
  fireEvent.click(await screen.findByText('测试草稿标题'));
  await screen.findByText('创建修改任务');
}

describe('ContentPage 审批 CAS 链（change console-cloud-panel-hardening #32）', () => {
  beforeEach(() => {
    state.published = { items: [makePending()] };
    state.queue = { status: 'idle', snapshot: null };
    state.accounts = { accounts: [] };
    state.delegatedTasks = { tasks: [] };
    state.delegatedTasksError = null;
    vi.mocked(apiGet).mockClear();
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
    // 候选稿动作直接确认入队：单次 draft 创建即返回 queued，无 /confirm 二次确认调用。
    vi.mocked(apiPost).mockImplementation((_path: string, body?: unknown) => {
      const action = String((body as { action?: string } | undefined)?.action ?? 'modify_candidate');
      return Promise.resolve(candidateTaskReceipt(action));
    });
  });

  it('内容页只加载稿件与账号，不再渲染或请求发布队列', async () => {
    renderPage();

    expect(await screen.findByText('测试草稿标题')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '发布队列' })).toBeNull();
    const requestedPaths = vi.mocked(apiGet).mock.calls.map(([path]) => String(path));
    expect(requestedPaths).not.toContain('/api/content/queue');
    expect(requestedPaths.some((path) => path.startsWith('/api/delegated-tasks'))).toBe(false);
  });

  it('独立队列页汇总活跃 5、等待人工 1、排队任务 0，并把审批交回内容页', async () => {
    const active = Array.from({ length: 5 }, (_, index) => journey({
      journeyId: `publish:${index + 1}`,
      runId: null,
      recordId: 158 + index,
      title: index === 0 ? '做Agent别光死磕大模型' : `第 ${index + 1} 份活跃稿件`,
      status: index === 0 ? 'waiting_approval' : 'generating',
      statusSummary: index === 0 ? '等待人工审批' : '正在生成候审稿',
    }, index === 0 ? { approval: 'waiting_human', dispatch: 'pending' } : {}));
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'waiting_human', active, recent: [] },
    };
    state.delegatedTasks = { tasks: [] };

    renderQueuePage();

    expect(await screen.findByRole('tab', { name: 'acc-1' })).toBeTruthy();
    expect(screen.queryByLabelText('选择活跃稿件')).toBeNull();
    expect(screen.getByText('做Agent别光死磕大模型')).toBeTruthy();
    expect(screen.getByText('第 5 份活跃稿件')).toBeTruthy();
    expect(document.querySelector('.publish-queue-metric--active .publish-queue-metric__value')?.textContent).toBe('5');
    expect(document.querySelector('.publish-queue-metric--human .publish-queue-metric__value')?.textContent).toBe('1');
    expect(document.querySelector('.publish-queue-metric--queued .publish-queue-metric__value')?.textContent).toBe('0');
    const approvalLink = await screen.findByRole('link', { name: '去内容页审批' });
    expect(approvalLink.getAttribute('href')).toBe('/content?status=pending_approval');
    expect(screen.getAllByText('平台下发')).toHaveLength(5);
    expect(screen.getAllByText('未开始').length).toBeGreaterThan(0);
  });

  it('发布队列运行中快照按阶段摘要展示，不再暴露原始字段', async () => {
    state.published = { items: [] };
    state.queue = {
      status: 'running',
      snapshot: {
        trigger: {
          accountId: 'acc-1',
          generateInput: {
            referenceNote: {
              title: '来稿标题',
              author: '原作者',
              images: [{ index: 0 }, { index: 1 }],
            },
          },
        },
        referenceAnalysis: { thesis: '原稿主旨' },
        faithfulDraft: { title: '洗稿后标题', content: '洗稿后的正文内容' },
        customDebug: { reason: 'keep-me' },
      },
    };

    renderQueuePage();

    expect(await screen.findByText('生成中')).toBeTruthy();
    expect((await screen.findAllByText('活跃稿件')).length).toBeGreaterThan(0);
    expect(screen.getByText('洗稿后标题')).toBeTruthy();
    expect(screen.getByText('来源：来稿标题')).toBeTruthy();
    expect(screen.getByText('参考图 2 张')).toBeTruthy();
    expect(screen.getByText('洗稿/正文')).toBeTruthy();
    expect(screen.getByText(/已产出：原稿分析、洗稿草稿/)).toBeTruthy();

    expect(screen.queryByText(/原始字段/)).toBeNull();
    expect(screen.queryByText('customDebug')).toBeNull();
    expect(screen.queryByText(/keep-me/)).toBeNull();
  });

  it('活跃稿件按账号横向切换，选中账号的所有任务一次性排在下方', async () => {
    state.accounts = {
      accounts: [
        { accountId: 'acc-a', nickname: '账号甲', label: null, displayName: '账号甲' } as unknown,
        { accountId: 'acc-b', nickname: '账号乙', label: null, displayName: '账号乙' } as unknown,
      ],
    };
    state.queue = {
      status: 'running',
      snapshot: null,
      lifecycle: {
        status: 'running',
        active: [
          journey({ journeyId: 'run:a1', runId: 'a1', accountId: 'acc-a', title: '甲账号任务一' }),
          journey({ journeyId: 'run:a2', runId: 'a2', accountId: 'acc-a', title: '甲账号任务二' }),
          journey({ journeyId: 'run:b1', runId: 'b1', accountId: 'acc-b', title: '乙账号任务一' }),
        ],
        recent: [],
      },
    };

    renderQueuePage();

    const accountTabs = await screen.findByRole('tablist', { name: '活跃账号' });
    expect(accountTabs.classList.contains('publish-queue-account-tabs')).toBe(true);
    const tabs = within(accountTabs).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['账号甲', '账号乙']);
    expect(screen.getByText('甲账号任务一')).toBeTruthy();
    expect(screen.getByText('甲账号任务二')).toBeTruthy();
    expect(screen.queryByText('乙账号任务一')).toBeNull();
    expect(screen.getAllByRole('region', { name: '排队中的发布任务' })).toHaveLength(1);

    fireEvent.click(within(accountTabs).getByRole('tab', { name: '账号乙' }));

    expect(await screen.findByText('乙账号任务一')).toBeTruthy();
    expect(screen.queryByText('甲账号任务一')).toBeNull();
    expect(screen.queryByText('甲账号任务二')).toBeNull();
  });

  it('发布队列独立展示尚未开跑的发布任务，并对旧 Cloud 回包二次过滤', async () => {
    state.published = { items: [] };
    state.queue = {
      status: 'running',
      snapshot: null,
      lifecycle: { status: 'running', active: [journey({ title: '当前活跃稿件' })], recent: [] },
    };
    state.delegatedTasks = {
      tasks: [
        delegatedTask(),
        delegatedTask({
          id: '22222222-2222-4222-8222-222222222222',
          status: 'executing',
          sourceConstraints: { title: '执行中不应重复出现' },
        }),
        delegatedTask({
          id: '33333333-3333-4333-8333-333333333333',
          action: 'comment_batch',
          actionFamily: 'comment',
          sourceConstraints: { title: '评论任务不应出现' },
        }),
      ],
    };

    renderQueuePage();

    await screen.findByText('排队来源标题');
    const panel = await screen.findByRole('region', { name: '排队中的发布任务' });
    expect(within(panel).getByText('排队来源标题')).toBeTruthy();
    expect(within(panel).getByText('工程师大白 · 发布稿件')).toBeTruthy();
    expect(within(panel).getByText('排队中')).toBeTruthy();
    expect(within(panel).getByText('任务 11111111')).toBeTruthy();
    expect(screen.queryByText('执行中不应重复出现')).toBeNull();
    expect(screen.queryByText('评论任务不应出现')).toBeNull();
    expect(screen.getByText('当前活跃稿件')).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls.some(([path]) => (
      path.includes('/api/delegated-tasks?')
      && path.includes('actionFamily=publish')
      && path.includes('statuses=queued%2Cplanning%2Cdeferred')
      && path.includes('limit=200')
    ))).toBe(true);
  });

  it('关闭取消确认时不发请求，任务保持在队列中', async () => {
    state.delegatedTasks = { tasks: [delegatedTask()] };

    renderQueuePage();

    fireEvent.click(await screen.findByRole('button', { name: '取消任务 排队来源标题' }));
    expect(await screen.findByText('取消“排队来源标题”？')).toBeTruthy();
    fireEvent.click(screen.getByText('暂不取消'));

    expect(vi.mocked(apiPost)).not.toHaveBeenCalled();
    expect(screen.getByText('排队来源标题')).toBeTruthy();
  });

  it('确认取消只提交对应任务 id 与版本，终态回执后刷新并移出排队区', async () => {
    const task = delegatedTask();
    const cancelledTask = delegatedTask({ status: 'cancelled', version: task.version + 1 });
    state.delegatedTasks = { tasks: [task] };
    vi.mocked(apiPost).mockImplementationOnce(() => {
      state.delegatedTasks = { tasks: [] };
      return Promise.resolve({ task: cancelledTask }) as never;
    });

    renderQueuePage();
    const cancelButton = await screen.findByRole('button', { name: '取消任务 排队来源标题' });
    const delegatedReadsBefore = vi.mocked(apiGet).mock.calls.filter(([path]) => String(path).startsWith('/api/delegated-tasks')).length;
    const queueReadsBefore = vi.mocked(apiGet).mock.calls.filter(([path]) => path === '/api/content/queue').length;

    fireEvent.click(cancelButton);
    fireEvent.click(await screen.findByText('确认取消'));

    await waitFor(() => expect(vi.mocked(apiPost)).toHaveBeenCalledWith(
      `/api/delegated-tasks/${task.id}/cancel`,
      { version: task.version },
    ));
    expect(await screen.findByText('排队任务已取消')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('排队来源标题')).toBeNull());
    await waitFor(() => {
      expect(vi.mocked(apiGet).mock.calls.filter(([path]) => String(path).startsWith('/api/delegated-tasks')).length).toBeGreaterThan(delegatedReadsBefore);
      expect(vi.mocked(apiGet).mock.calls.filter(([path]) => path === '/api/content/queue').length).toBeGreaterThan(queueReadsBefore);
    });
  });

  it('规划中取消请求只标记取消中，并在请求期间阻止重复提交', async () => {
    const planningTask = delegatedTask({
      status: 'planning',
      sourceConstraints: { title: '规划中的稿件' },
    });
    const otherTask = delegatedTask({
      id: '22222222-2222-4222-8222-222222222222',
      sourceConstraints: { title: '另一个排队任务' },
    });
    const cancellingTask = delegatedTask({
      status: 'planning',
      sourceConstraints: { title: '规划中的稿件' },
      cancelRequested: true,
      version: planningTask.version + 1,
    });
    state.delegatedTasks = { tasks: [planningTask, otherTask] };
    let resolveCancel!: (value: { task: DelegatedTaskView }) => void;
    const pendingCancel = new Promise<{ task: DelegatedTaskView }>((resolve) => {
      resolveCancel = resolve;
    });
    vi.mocked(apiPost).mockImplementationOnce(() => pendingCancel as never);

    renderQueuePage();

    fireEvent.click(await screen.findByRole('button', { name: '取消任务 规划中的稿件' }));
    fireEvent.click(await screen.findByText('确认取消'));
    await waitFor(() => expect(vi.mocked(apiPost)).toHaveBeenCalledTimes(1));
    const currentButton = screen.getByRole('button', { name: '取消任务 规划中的稿件' });
    const otherButton = screen.getByRole('button', { name: '取消任务 另一个排队任务' }) as HTMLButtonElement;
    await waitFor(() => expect(currentButton.classList.contains('ant-btn-loading')).toBe(true));
    expect(otherButton.disabled).toBe(true);
    fireEvent.click(otherButton);
    expect(vi.mocked(apiPost)).toHaveBeenCalledTimes(1);

    state.delegatedTasks = { tasks: [cancellingTask, otherTask] };
    resolveCancel({ task: cancellingTask });

    expect(await screen.findByText('取消请求已受理，任务将在安全边界停止')).toBeTruthy();
    const planningCard = (await screen.findByText('规划中的稿件')).closest('.publish-queued-task');
    expect(planningCard).toBeTruthy();
    expect(within(planningCard as HTMLElement).getByText('取消中')).toBeTruthy();
    expect(within(planningCard as HTMLElement).queryByRole('button', { name: '取消任务 规划中的稿件' })).toBeNull();
    expect((screen.getByRole('button', { name: '取消任务 另一个排队任务' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('取消遇到版本冲突时刷新最新状态、不自动重试且不暴露机器码', async () => {
    state.delegatedTasks = { tasks: [delegatedTask()] };
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(409, 'version_conflict'));

    renderQueuePage();
    const cancelButton = await screen.findByRole('button', { name: '取消任务 排队来源标题' });
    const delegatedReadsBefore = vi.mocked(apiGet).mock.calls.filter(([path]) => String(path).startsWith('/api/delegated-tasks')).length;

    fireEvent.click(cancelButton);
    fireEvent.click(await screen.findByText('确认取消'));

    expect(await screen.findByText('任务状态已变化，已刷新；请确认最新状态后重试')).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
    expect(screen.getByText('排队来源标题')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      vi.mocked(apiGet).mock.calls.filter(([path]) => String(path).startsWith('/api/delegated-tasks')).length,
    ).toBeGreaterThan(delegatedReadsBefore));
  });

  it('取消失败时保留任务并显示说人话回退文案', async () => {
    state.delegatedTasks = { tasks: [delegatedTask()] };
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(503, 'delegated_tasks_unavailable'));

    renderQueuePage();

    fireEvent.click(await screen.findByRole('button', { name: '取消任务 排队来源标题' }));
    fireEvent.click(await screen.findByText('确认取消'));

    expect(await screen.findByText('取消任务失败，请稍后重试')).toBeTruthy();
    expect(screen.queryByText('delegated_tasks_unavailable')).toBeNull();
    expect(screen.getByText('排队来源标题')).toBeTruthy();
  });

  it('暂缓任务展示稳定等待原因与预计检查时间，未知步骤不猜测', async () => {
    const nextEligibleAt = new Date('2026-07-20T11:40:00+08:00').getTime();
    state.published = { items: [] };
    state.queue = { status: 'idle', snapshot: null };
    state.delegatedTasks = {
      tasks: [
        delegatedTask({
          status: 'deferred',
          currentStep: 'waiting_ownership',
          nextEligibleAt,
          sourceConstraints: { title: '同源等待稿' },
        }),
        delegatedTask({
          id: '22222222-2222-4222-8222-222222222222',
          status: 'deferred',
          currentStep: 'waiting_safe_slot',
          nextEligibleAt,
          sourceConstraints: { title: '槽位等待稿' },
        }),
        delegatedTask({
          id: '33333333-3333-4333-8333-333333333333',
          status: 'deferred',
          currentStep: 'future_unknown_step',
          nextEligibleAt,
          sourceConstraints: { title: '未知步骤稿' },
        }),
      ],
    };

    renderQueuePage();

    const panel = await screen.findByRole('region', { name: '排队中的发布任务' });
    await within(panel).findByText('同源等待稿');
    expect(within(panel).getByText('等待同一参照稿的在途任务释放')).toBeTruthy();
    expect(within(panel).getByText('生成槽位暂满，任务仍在排队')).toBeTruthy();
    expect(within(panel).getAllByText('预计再次检查 07-20 11:40')).toHaveLength(3);
    expect(within(panel).queryByText(/下次尝试/)).toBeNull();
    const unknownCard = within(panel).getByText('未知步骤稿').closest('.publish-queued-task');
    expect(unknownCard).toBeTruthy();
    expect(within(unknownCard as HTMLElement).queryByText(/等待|暂停|槽位/)).toBeNull();
  });

  it('排队任务查询失败时保留活跃稿件并显示独立错误', async () => {
    state.published = { items: [] };
    state.queue = {
      status: 'running',
      snapshot: null,
      lifecycle: { status: 'running', active: [journey({ title: '错误隔离活跃稿件' })], recent: [] },
    };
    state.delegatedTasksError = new Error('queue unavailable');

    renderQueuePage();

    expect((await screen.findAllByText('排队任务加载失败')).length).toBeGreaterThan(0);
    expect(screen.getByText('错误隔离活跃稿件')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'acc-1' })).toBeTruthy();
  });

  it('并行多轮：可切换查看每一轮详情，账号显示昵称不裸 id（2026-07-09 用户反馈）', async () => {
    state.published = { items: [] };
    state.accounts = {
      accounts: [{ accountId: 'acc-1', nickname: '小红薯甲', label: null, displayName: '小红薯甲' } as unknown],
    };
    const runOf = (runId: string, sourceId: string, title: string, startedAt: number) => ({
      runId,
      accountId: 'acc-1',
      kind: 'rewrite' as const,
      sourceId,
      startedAt,
      status: 'running',
      snapshot: {
        trigger: { accountId: 'acc-1', generateInput: { referenceNote: { title: `来稿-${sourceId}` } } },
        faithfulDraft: { title },
      },
    });
    state.queue = {
      status: 'running',
      snapshot: null, // 聚合字段可为空——有 runs 时详情完全由选中轮驱动
      runs: [runOf('r1', 's1', '甲稿标题', 1), runOf('r2', 's2', '乙稿标题', 2)],
    };

    renderQueuePage();

    // 默认跟随最新启动的一轮（r2）。
    expect(await screen.findByText('乙稿标题')).toBeTruthy();
    // 账号显示昵称（草稿事实 + 阶段 fact 多处），绝不裸 id。
    expect(screen.getAllByText('账号 小红薯甲').length).toBeGreaterThan(0);
    expect(screen.queryByText(/账号 acc-1/)).toBeNull();
    // 切到第一轮（Segmented 首个选项）→ 详情换成甲稿。
    fireEvent.click(screen.getAllByText(/小红薯甲 · 洗稿/)[0]);
    expect(await screen.findByText('甲稿标题')).toBeTruthy();
  });

  it('新 cloud 生命周期优先展示八阶段，不再展示原始快照', async () => {
    state.published = { items: [] };
    state.accounts = { accounts: [{ accountId: 'acc-1', nickname: 'Tmax', label: null, displayName: 'Tmax' } as unknown] };
    state.queue = {
      status: 'running',
      snapshot: null,
      lifecycle: { status: 'running', active: [journey()], recent: [] },
    };

    renderQueuePage();

    expect(await screen.findByText('执行中')).toBeTruthy();
    expect(screen.getByText('八阶段测试稿件')).toBeTruthy();
    expect(screen.getByText('Tmax')).toBeTruthy();
    for (const label of lifecycleStageLabels) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('洗稿/正文')).toBeNull();

    expect(screen.queryByText(/原始字段/)).toBeNull();
    expect(screen.queryByText('customDebug')).toBeNull();
    expect(screen.queryByText(/lifecycle-raw/)).toBeNull();
  });

  it('待审和下发中使用明确阶段状态，不折叠成同一个人审/下发阶段', async () => {
    const waiting = journey({
      journeyId: 'publish:1', runId: null, recordId: 1, active: true, status: 'waiting_approval',
      statusSummary: '候审稿已完成，等待人工审批', snapshot: null,
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'waiting_human', dispatch: 'pending' });
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'waiting_human', active: [waiting], recent: [] },
    };
    renderQueuePage();

    expect(await screen.findByText('等待审批')).toBeTruthy();
    expect(screen.getAllByText('等待人工').length).toBeGreaterThan(0);
    expect(screen.getByText('人工审批')).toBeTruthy();
    expect(screen.getByText('平台下发')).toBeTruthy();
    expect(screen.getAllByText('未开始').length).toBeGreaterThan(0);
  });

  it('dispatcher 在途稿显示审批完成与平台下发中', async () => {
    const dispatching = journey({
      journeyId: 'publish:2', runId: null, recordId: 2, active: true, status: 'dispatching',
      statusSummary: '审批已通过，正在向平台下发', snapshot: null,
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'completed', dispatch: 'running' });
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'running', active: [dispatching], recent: [] },
    };
    renderQueuePage();

    expect(await screen.findByText('平台下发中')).toBeTruthy();
    expect(screen.getByText('平台下发')).toBeTruthy();
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  });

  it('in-flight 证据 stale 时不归类为等待人工/下发中，确定汇总显示未知', async () => {
    const uncertain = journey({
      journeyId: 'publish:unavailable',
      runId: null,
      recordId: 6,
      active: true,
      status: 'waiting_approval',
      statusSummary: '旧投影仍写着等待审批，但 dispatcher 证据已经陈旧',
      snapshot: null,
    }, {
      source: 'completed',
      content: 'completed',
      text_quality: 'completed',
      visual_plan: 'completed',
      image_review: 'completed',
      package: 'completed',
      approval: 'waiting_human',
      dispatch: 'pending',
    });
    state.queue = {
      status: 'completed',
      snapshot: null,
      inFlightEvidence: { state: 'stale', asOf: 1_700_000_000_000 },
      lifecycle: { status: 'waiting_human', active: [uncertain], recent: [] },
    };
    renderQueuePage();

    expect((await screen.findAllByText('下发状态暂不可用')).length).toBeGreaterThan(0);
    const activeMetric = document.querySelector('.publish-queue-metric--active');
    const waitingMetric = document.querySelector('.publish-queue-metric--human');
    expect(activeMetric?.querySelector('.publish-queue-metric__value')?.textContent).toBe('—');
    expect(waitingMetric?.querySelector('.publish-queue-metric__value')?.textContent).toBe('—');
    expect(activeMetric?.textContent).toContain('未计入确定汇总');
    expect(waitingMetric?.textContent).toContain('未归类为等待人工或下发中');
    const dispatchStage = screen.getByText('平台下发').closest('.publish-queue-stage');
    expect(dispatchStage?.textContent).toContain('证据暂不可用');
    expect(dispatchStage?.textContent).not.toContain('未开始');
    expect(screen.queryByRole('link', { name: '去内容页审批' })).toBeNull();
    expect(screen.queryByText('等待审批')).toBeNull();
    expect(screen.queryByText('平台下发中')).toBeNull();
  });

  // ── change publish-approval-signal-to-database：已批准·待下发是独立可见状态 ──────────────
  it('已批准·待下发：与「等待审批」可区分，展示阻塞原因与等待时长', async () => {
    const pending = journey({
      journeyId: 'publish:3', runId: null, recordId: 3, active: true, status: 'dispatching',
      statusSummary: '已批准·待下发（客户端核心离线，等待恢复）', snapshot: null,
      dispatchState: 'pending_dispatch', dispatchBlockedReason: 'edge_offline_waiting',
      decidedAt: 1_700_000_000_000, waitingMs: 7 * 60_000,
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'completed', dispatch: 'pending' });
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'running', active: [pending], recent: [] },
    };
    renderQueuePage();

    expect(await screen.findByText('已批准·待下发')).toBeTruthy();
    expect(screen.queryByText('等待审批')).toBeNull();
    expect(screen.getByText('已等待 7 分钟')).toBeTruthy();
    expect(screen.getByText('客户端核心离线，等待恢复')).toBeTruthy();
    expect(screen.queryByText('无阻塞原因，下发侧疑似失联')).toBeNull();
  });

  it('无阻塞原因且久等 → 打出「下发侧疑似失联」告警标记', async () => {
    const stalled = journey({
      journeyId: 'publish:4', runId: null, recordId: 4, active: true, status: 'dispatching',
      statusSummary: '已批准·待下发', snapshot: null,
      dispatchState: 'pending_dispatch', dispatchBlockedReason: null,
      decidedAt: 1_700_000_000_000, waitingMs: 40 * 60_000,
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'completed', dispatch: 'pending' });
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'running', active: [stalled], recent: [] },
    };
    renderQueuePage();

    expect(await screen.findByText('已批准·待下发')).toBeTruthy();
    expect(screen.getByText('无阻塞原因，下发侧疑似失联')).toBeTruthy();
    expect(screen.getByText('已等待 40 分钟')).toBeTruthy();
  });

  it('下发态字段缺省（旧 cloud）→ 回落既有呈现，不白屏不报错', async () => {
    const legacy = journey({
      journeyId: 'publish:5', runId: null, recordId: 5, active: true, status: 'dispatching',
      statusSummary: '审批已通过，正在向平台下发', snapshot: null,
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'completed', dispatch: 'running' });
    state.queue = {
      status: 'completed',
      snapshot: null,
      lifecycle: { status: 'running', active: [legacy], recent: [] },
    };
    renderQueuePage();

    expect(await screen.findByText('平台下发中')).toBeTruthy();
    expect(screen.queryByText('已批准·待下发')).toBeNull();
  });

  it('失败终态只显示在最近结果，不再因 snapshot 存在冒充活跃稿件', async () => {
    const failed = journey({
      journeyId: 'publish:112', runId: null, recordId: 112, active: false, status: 'failed',
      title: 'Agent选型别盲信榜单高分', statusSummary: '平台下发失败，未确认发布',
    }, { source: 'completed', content: 'completed', text_quality: 'completed', visual_plan: 'completed', image_review: 'completed', package: 'completed', approval: 'completed', dispatch: 'failed' });
    state.queue = {
      status: 'failed',
      snapshot: { stale: true },
      lifecycle: { status: 'idle', active: [], recent: [failed] },
    };
    renderQueuePage();

    expect(await screen.findByText('无活跃稿件')).toBeTruthy();
    expect(screen.getByText('最近结果 · 失败')).toBeTruthy();
    expect(screen.getByText('平台下发失败，未确认发布')).toBeTruthy();
    const activeMetric = screen.getByText('活跃稿件').closest('.publish-queue-metric');
    expect(activeMetric?.textContent).toContain('0');
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
  });

  it('修改候选稿直接入队（无确认卡），携 CAS 版本写 draft，且不直接写 draft 端点', async () => {
    await openEditDrawer();
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: '改后的标题' } });
    fireEvent.click(screen.getByText('创建修改任务'));
    // 单次创建即入队；成功文案明确「成功状态以平台验证结果为准」。
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    // 已被移除的「请确认用户委托任务」二次确认卡不再出现。
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
    // 副作用闸：绝不绕过任务通道直接 PUT 写 draft。
    expect(vi.mocked(apiPut)).not.toHaveBeenCalled();
    // CAS 版本随创建调用一同下发（candidateVersion=浮层打开时快照版本）。
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      action: 'modify_candidate',
      targetConstraints: expect.objectContaining({ candidateId: '1', candidateVersion: 0, title: '改后的标题' }),
    }));
    expect(vi.mocked(apiPost).mock.calls.some(([path]) => String(path).includes('/confirm'))).toBe(false);
  });

  it('CAS 版本冲突时诚实拒绝，不显示排队成功', async () => {
    // 冲突现在发生在创建调用本身（携 candidateVersion 的 draft 创建被后端 409 拒）。
    vi.mocked(apiPost).mockRejectedValue(new ApiError(409, 'version_conflict'));
    await openEditDrawer();
    fireEvent.change(screen.getByPlaceholderText('标题'), { target: { value: '改后的标题' } });
    fireEvent.click(screen.getByText('创建修改任务'));
    expect(await screen.findByText(/内容已被他处修改，请刷新后重试/)).toBeTruthy();
    expect(screen.queryByText(/成功状态以平台验证结果为准/)).toBeNull();
    expect(screen.queryByText('version_conflict')).toBeNull();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
  });

  it('无改动时修改任务按钮禁用，避免生成空补丁', async () => {
    await openEditDrawer();
    expect((screen.getByRole('button', { name: '创建修改任务' }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(apiPost)).not.toHaveBeenCalled();
  });

  it('定时设置排在标题/正文之后；切回立即发布通过同一候选稿 CAS 保存并清空时间', async () => {
    const publishTime = Date.now() + 2 * 60 * 60 * 1000;
    state.published = { items: [makePending({ publishMode: 'scheduled', publishTime })] };
    await openEditDrawer();

    const titleInput = screen.getByPlaceholderText('标题');
    const bodyInput = screen.getByPlaceholderText('正文');
    const timingLabel = screen.getByText('发布时机');
    expect(titleInput.compareDocumentPosition(bodyInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bodyInput.compareDocumentPosition(timingLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/定时设置在标题、正文、配图、话题与发布选项完成后应用/)).toBeTruthy();

    fireEvent.click(screen.getByText('审核后立即发布'));
    fireEvent.click(screen.getByText('创建修改任务'));
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      action: 'modify_candidate',
      targetConstraints: expect.objectContaining({
        candidateId: '1',
        candidateVersion: 0,
        publishMode: 'immediate',
        publishTime: null,
      }),
    }));
  });

  it('已发布行点整行 → 笔记详情浮层：正文保留换行、配图渲染、详情页链接', async () => {
    state.published = {
      items: [
        makePending({
          status: 'published',
          title: '已发布标题',
          content: '第一段\n第二段',
          platformPostId: 'post-9',
          postUrl: 'https://www.xiaohongshu.com/explore/post-9?xsec_token=tok',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imagesAttachedCount: 1,
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('已发布标题'));
    // 浮层就绪：出现详情页跳转按钮（非编辑态无 保存草稿）。
    const openBtn = await screen.findByRole('link', { name: '打开小红书详情页' });
    expect(openBtn.getAttribute('href')).toContain('xsec_token');
    expect(screen.queryByText('保存草稿')).toBeNull();
    // 正文整段（含换行）在同一文本节点里（pre-wrap 渲染）；testing-library 默认归一化会折叠 \n，
    // 故用自定义 matcher 直查元素原始 textContent。
    const body = await screen.findByText((_c, el) => el?.textContent === '第一段\n第二段');
    expect(body.textContent).toContain('\n');
    // 配图以 <img> 渲染（OSS 公读链接直挂）。
    const img = document.querySelector('img[src*="aidcp.oss-cn-beijing"]');
    expect(img).toBeTruthy();
    expect(screen.getByText(/配图 1 张（发布时实际附着 1 张）/)).toBeTruthy();
    expect(screen.queryByText(/当前图片厂商不支持参考图/)).toBeNull();
    expect(screen.queryByText(/图片模型已实际使用参考图/)).toBeNull();
  });

  it('页面已提交但未取得链接 → 显示待链接确认，不伪装成已发布或失败', async () => {
    state.published = { items: [makePending({ status: 'submitted', title: '待链接确认帖子' })] };
    renderPage();
    expect(await screen.findByRole('row', { name: /测试账号.*待链接确认帖子.*已提交，待链接确认/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /测试账号.*待链接确认帖子.*已发布/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /测试账号.*待链接确认帖子.*失败/ })).toBeNull();
  });

  it('参照洗稿配图审计：unsupported 明确提示按文本重新生成', async () => {
    state.published = {
      items: [
        makePending({
          status: 'pending_approval',
          title: '洗稿待审标题',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imageReferenceAudit: {
            requestedCount: 2,
            usableCount: 2,
            status: 'unsupported',
            providerClaimedUsed: false,
            generatedCount: 1,
          },
          sourceReference: {
            kind: 'curated_reference',
            curatedContentId: 7,
            accountId: 'acc-1',
            sourceId: 'note-42',
            title: '来稿标题',
            body: '来稿正文',
            author: '原作者',
            topics: [],
            sourceUrl: null,
            capturedAt: new Date('2026-07-03T09:00:00').getTime(),
          },
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('洗稿待审标题'));
    expect(await screen.findByText(/参考图 2 张；当前图片厂商不支持参考图，配图已按文本重新生成/)).toBeTruthy();
  });

  it('参照洗稿配图审计：used 明确提示图片模型已使用参考图', async () => {
    state.published = {
      items: [
        makePending({
          status: 'pending_approval',
          title: '已用参考图标题',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imageReferenceAudit: {
            requestedCount: 1,
            usableCount: 1,
            status: 'used',
            providerClaimedUsed: true,
            generatedCount: 1,
          },
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('已用参考图标题'));
    expect(await screen.findByText(/参考图 1 张；图片模型已实际使用参考图生成新图/)).toBeTruthy();
  });

  it('视觉审计区分 provider used 与保真未核验，并展示逐槽绑定和原因', async () => {
    state.published = { items: [makePending({
      title: '视觉审计草稿',
      images: ['https://oss.test/out.jpg'],
      imageReferenceAudit: { requestedCount: 1, usableCount: 1, status: 'used', providerClaimedUsed: true, generatedCount: 1 },
      visualReferenceAudit: {
        analysisStatus: 'analyzed', analysisCacheKey: 'k', bindingMode: 'slot', auditEnabled: true,
        slots: [{
          slot: 0, route: 'specialized_generative', styleSource: 'reference_analysis', providerReferenceStatus: 'used',
          binding: { slot: 0, mode: 'slot', primarySourceArrayIndex: 0, primarySourceIndex: 7, references: [{ sourceArrayIndex: 0, sourceIndex: 7, url: 'https://ref.test/a.jpg', role: 'primary' }] },
          outputUrl: 'https://oss.test/out.jpg', finalStatus: 'unverified',
          contentVisualBrief: {
            narrativeMoment: '情绪涌来后自我整理', emotion: '脆弱但不崩溃', emotionIntensity: 0.65,
            action: '缓慢呼吸', environment: '安静室内', facialExpression: '眉眼游离、嘴角克制',
            gazeDirection: '侧视', headAngle: '微侧', bodyLanguage: '肩颈放松', avoid: ['标准商业微笑'],
            categoryBrief: {
              kind: 'portrait_photo', facialExpression: '眉眼游离、嘴角克制', gazeDirection: '侧视', headAngle: '微侧',
              bodyLanguage: '肩颈放松', gesture: '手指自然放松', poseEnergy: '低唤醒但有内在张力',
            },
          },
          attempts: [{
            status: 'unverified', reason: 'vision timeout', auditedAt: 1,
            scores: { form: 0.8, subject: 0.8, composition: 0.8, color: 0.8, style: 0.8, contentAlignment: 0.42 },
          }],
        }],
      },
    })] };
    renderPage();
    fireEvent.click(await screen.findByText('视觉审计草稿'));
    expect(await screen.findByText(/0 槽通过，1 槽未核验/)).toBeTruthy();
    expect(screen.queryByText(/保真核验通过/)).toBeNull();
    fireEvent.click(screen.getByText('查看逐槽视觉审计'));
    expect(await screen.findByText(/主参考：源图 #7；尝试 1 次；vision timeout/)).toBeTruthy();
    expect(screen.getByText('未经视觉核验')).toBeTruthy();
    expect(screen.getByText(/脆弱但不崩溃（强度 0.65）/)).toBeTruthy();
    expect(screen.getByText(/动作：缓慢呼吸；环境：安静室内/)).toBeTruthy();
    expect(screen.getByText(/人物表演：眉眼游离、嘴角克制；侧视；微侧；肩颈放松/)).toBeTruthy();
    expect(screen.getByText('人物摄影')).toBeTruthy();
    expect(screen.getByText(/手势与姿态：手指自然放松；低唤醒但有内在张力/)).toBeTruthy();
    expect(screen.getByText(/避免：标准商业微笑/)).toBeTruthy();
    expect(screen.getByText(/正文一致 0.42/)).toBeTruthy();
  });

  it('原创配图展示整组视觉计划、槽位职责和无来源的正文类型核验', async () => {
    state.published = { items: [makePending({
      title: '原创视觉计划草稿',
      images: ['https://oss.test/original.jpg'],
      visualReferenceAudit: {
        analysisStatus: 'none', analysisCacheKey: null, bindingMode: 'none', auditEnabled: true,
        visualSetBrief: {
          narrativeArc: '先指出问题，再解释闭环，最后给行动',
          continuityRules: ['统一冷蓝和米白', '重复使用环形箭头'],
          typeMixRationale: '信息图承担因果解释',
          source: 'model',
        },
        slots: [{
          slot: 0, auditMode: 'content_alignment', slotRole: 'explanation',
          route: 'specialized_generative', styleSource: 'category_fallback', providerReferenceStatus: 'skipped',
          binding: { slot: 0, mode: 'legacy_all', primarySourceArrayIndex: null, primarySourceIndex: null, references: [] },
          outputUrl: 'https://oss.test/original.jpg', finalStatus: 'passed',
          contentVisualBrief: {
            narrativeMoment: '解释反馈闭环', emotion: '理性', emotionIntensity: 0.4,
            action: '沿闭环阅读', environment: '无数值信息图', avoid: ['编造数字'],
            categoryBrief: {
              kind: 'infographic_chart', claim: '反馈推动改进', relationship: '循环', entities: ['生成', '验证', '改进'],
              direction: '顺时针', steps: ['生成', '验证', '改进'], dataPolicy: '正文无数字，只画无数值关系',
            },
          },
          attempts: [{
            status: 'passed', reason: '关系和正文一致', auditedAt: 1,
            scores: { form: 0.9, subject: 0.88, composition: 0.82, color: 0.8, style: 0.84, contentAlignment: 0.91 },
            risks: {
              recognizableRealPerson: false, garbledText: false, watermark: false, copiedText: false,
              copyCheck: 'not_applicable', originalityRisk: 'low',
            },
          }],
        }],
      },
    })] };
    renderPage();
    fireEvent.click(await screen.findByText('原创视觉计划草稿'));
    expect(await screen.findByText(/原创配图审计：无参考绑定；1 槽通过/)).toBeTruthy();
    expect(screen.getByText(/不做来源相似度或复制判断/)).toBeTruthy();
    fireEvent.click(screen.getByText('查看逐槽视觉审计'));
    expect(await screen.findByText('整组视觉计划')).toBeTruthy();
    expect(screen.getByText(/先指出问题，再解释闭环，最后给行动/)).toBeTruthy();
    expect(screen.getByText(/统一冷蓝和米白；重复使用环形箭头/)).toBeTruthy();
    expect(screen.getByText('解释机制')).toBeTruthy();
    expect(screen.getByText('正文与类型核验')).toBeTruthy();
    expect(screen.getByText(/审核模式：正文与类型核验；无来源比较；尝试 1 次/)).toBeTruthy();
    expect(screen.getByText('正文与类型核验通过')).toBeTruthy();
    expect(screen.getByText('来源复制检查不适用')).toBeTruthy();
    expect(screen.queryByText('provider skipped')).toBeNull();
  });

  it('八类正文视觉 brief 均转换为可读标签和分类语义', () => {
    const categories: PanelContentVisualCategoryBrief[] = [
      { kind: 'portrait_photo', facialExpression: '克制', gazeDirection: '侧视', headAngle: '微侧', bodyLanguage: '放松', gesture: '垂手', poseEnergy: '低唤醒' },
      { kind: 'text_layout', coreMessage: '先结论', informationHierarchy: ['结论', '依据'], emphasisTerms: ['闭环'], readingOrder: '从上到下', informationDensity: '中等', cardStructure: '封面加要点' },
      { kind: 'infographic_chart', claim: '步骤递进', relationship: '因果', entities: ['问题', '行动'], direction: '左到右', steps: ['观察', '验证'], dataPolicy: '无数字则不用数值' },
      { kind: 'scene_photo', timeAndWeather: '清晨', location: '办公室', humanPresence: '一人', eventTrace: '刚完成记录', spatialRelationship: '前中后景', motionLevel: '低动态' },
      { kind: 'still_life_photo', primaryObjects: ['笔记本'], usageState: '翻开', objectRelationship: '工具协作', lifeTrace: '有使用痕迹', materialFocus: '纸张', handInteraction: '正在书写' },
      { kind: 'illustration_3d', coreMetaphor: '穿过迷雾', characterRelationship: '个体与阻力', symbols: ['路标'], motionDirection: '向前', exaggerationLevel: '适度', storyStage: '找到方向' },
      { kind: 'ui_document', userTask: '查看评分', interfaceState: '结果页', componentHierarchy: ['总分', '分项'], interactionPath: ['打开', '查看'], informationFocus: '差异', fidelityLabel: '概念界面' },
      { kind: 'collage_mixed', regions: [{ role: '主区', content: '结论', priority: '高' }], readingOrder: '先主后次', primarySecondaryRatio: '2:1', continuityElements: ['绿色'] },
    ];
    const labels = categories.map((category) => visualCategoryPresentation(category).label);
    expect(labels).toEqual(['人物摄影', '文字卡/海报', '图表信息图', '场景摄影', '静物摄影', '插画/3D', 'UI/文档', '混合拼贴']);
    expect(visualCategoryPresentation(categories[2]!).lines.join('')).toContain('数据边界：无数字则不用数值');
    expect(visualCategoryPresentation(categories[6]!).lines.join('')).toContain('真实性边界：概念界面');
  });

  it('无改动时批准操作直接入队，不绕过任务直接写审批信号', async () => {
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '创建批准任务' }));
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      action: 'approve_candidate',
      targetConstraints: expect.objectContaining({ candidateId: '1', candidateVersion: 0 }),
    }));
    // 副作用闸：批准只经任务通道，绝不直接命中发布/审批信号端点。
    expect(vi.mocked(apiPost).mock.calls.some(([path]) => String(path).includes('/api/publish/'))).toBe(false);
  });

  it('驳回直接入队；入队后候选仍保持待审（不乐观改状态）', async () => {
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '创建驳回任务' }));
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      action: 'reject_candidate',
    }));
    // 驳回任务仅入队、尚未执行，列表不乐观改成已驳回，仍如实显示待审。
    expect(screen.getAllByText('待审').length).toBeGreaterThan(0);
  });

  it('参照洗稿行展示来稿件入口；点击来源不打开发布详情', async () => {
    state.published = {
      items: [
        makePending({
          status: 'published',
          title: '洗稿后标题',
          content: '发布正文',
          sourceReference: {
            kind: 'curated_reference',
            curatedContentId: 7,
            accountId: 'acc-1',
            sourceId: 'note-42',
            title: '来稿标题',
            body: '来稿第一段\n来稿第二段',
            author: '原作者',
            topics: ['收纳', '家居'],
            sourceUrl: null,
            capturedAt: new Date('2026-07-03T09:00:00').getTime(),
          },
        }),
      ],
    };
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /洗稿.*来稿标题/ }));
    expect(await screen.findByText('洗稿来稿')).toBeTruthy();
    expect(screen.getByText('原作者')).toBeTruthy();
    const body = await screen.findByText((_c, el) => el?.textContent === '来稿第一段\n来稿第二段');
    expect(body.textContent).toContain('\n');
    expect(screen.getByText('#收纳')).toBeTruthy();
    expect(screen.getByText('无来源链接')).toBeTruthy();
    expect(screen.queryByText('回执：')).toBeNull();
  });

  it('普通发布不展示洗稿来源入口', async () => {
    state.published = { items: [makePending({ status: 'published', title: '普通发布' })] };
    renderPage();
    await screen.findByText('普通发布');
    expect(screen.queryByRole('button', { name: /洗稿/ })).toBeNull();
  });
});

describe('ContentPage 待审配图删除（change pending-draft-image-delete）', () => {
  beforeEach(() => {
    state.queue = { status: 'idle', snapshot: null };
    state.accounts = { accounts: [] };
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
    // 删配图=修改候选稿，直接确认入队：单次 draft 创建即返回 queued，无 /confirm 调用。
    vi.mocked(apiPost).mockImplementation((_path: string, body?: unknown) =>
      Promise.resolve(candidateTaskReceipt(String((body as { action?: string } | undefined)?.action ?? 'modify_candidate'))),
    );
  });

  it('删一张配图 → 携保留子集直接入队修改任务，不经确认卡、不直接写 draft 端点', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg', 'https://c.jpg'], imageUrl: 'https://a.jpg' })] };
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    // 这是配图删除的确认气泡（合法控件），非已移除的「请确认用户委托任务」委托确认卡。
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      action: 'modify_candidate', targetConstraints: expect.objectContaining({ images: ['https://b.jpg', 'https://c.jpg'] }),
    }));
    expect(vi.mocked(apiPut)).not.toHaveBeenCalled();
  });

  it('删最后一张 → 删除气泡提示纯文字帖，直接入队并在任务约束中锁定空 images', async () => {
    state.published = { items: [makePending({ images: ['https://only.jpg'], imageUrl: 'https://only.jpg' })] };
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    // 删除最后一张的气泡二次确认（合法控件）仍在，如实提示将作为纯文字帖。
    expect(await screen.findByText('删除最后一张配图？该帖将作为纯文字帖发布')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText(/成功状态以平台验证结果为准/)).toBeTruthy();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/draft', expect.objectContaining({
      targetConstraints: expect.objectContaining({ images: [] }),
    }));
  });

  it('删配图任务草稿创建失败 → 配图保持可见且不染绿', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg'], imageUrl: 'https://a.jpg' })] };
    vi.mocked(apiPost).mockRejectedValue(new ApiError(409, 'version_conflict'));
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('内容已被他处修改，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
    expect(document.querySelector('img[src="https://a.jpg"]')).toBeTruthy();
  });

  it('删配图 invalid_field（防注入/过期）→ 中文拒因', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg'], imageUrl: 'https://a.jpg' })] };
    vi.mocked(apiPost).mockRejectedValue(new ApiError(400, 'invalid_field'));
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('提交内容不合法或已过期，请刷新后重试')).toBeTruthy();
  });

  it('已发布记录（查看态）不显示删除入口', async () => {
    state.published = { items: [makePending({ status: 'published', title: '已发布帖', images: ['https://a.jpg'], imageUrl: 'https://a.jpg' })] };
    renderPage();
    fireEvent.click(await screen.findByText('已发布帖'));
    await screen.findByText('无链接');
    expect(screen.queryByRole('button', { name: /删除配图/ })).toBeNull();
  });
});
