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
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentPage, visualCategoryPresentation } from './ContentPage';
import { ApiError, apiPost, apiPut } from '../api/client';
import type {
  ContentQueue,
  ContentQueueJourney,
  ContentQueueStageState,
  DelegatedTaskDraftReceipt,
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
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual, // 保留真实 ApiError / UnauthorizedError，使 errorText 的 instanceof 命中同一类
    apiGet: vi.fn((path: string) => {
      if (path.startsWith('/api/accounts')) return Promise.resolve(state.accounts);
      if (path.startsWith('/api/content/published')) return Promise.resolve(state.published);
      if (path === '/api/content/queue') return Promise.resolve(state.queue);
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
    platformPostId: null,
    publishedAt: new Date('2026-07-03T10:00:00').getTime(),
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

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ContentPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>,
  );
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
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
    // 候选稿动作直接确认入队：单次 draft 创建即返回 queued，无 /confirm 二次确认调用。
    vi.mocked(apiPost).mockImplementation((_path: string, body?: unknown) => {
      const action = String((body as { action?: string } | undefined)?.action ?? 'modify_candidate');
      return Promise.resolve(candidateTaskReceipt(action));
    });
  });

  it('发布队列运行中快照按阶段摘要展示，并保留原始字段', async () => {
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

    renderPage();

    expect(await screen.findByText('生成中')).toBeTruthy();
    expect(await screen.findByText('活跃稿件')).toBeTruthy();
    expect(screen.getByText('洗稿后标题')).toBeTruthy();
    expect(screen.getByText('来源：来稿标题')).toBeTruthy();
    expect(screen.getByText('参考图 2 张')).toBeTruthy();
    expect(screen.getByText('洗稿/正文')).toBeTruthy();
    expect(screen.getByText(/已产出：原稿分析、洗稿草稿/)).toBeTruthy();

    fireEvent.click(screen.getByText(/原始字段/));

    expect(await screen.findByText('customDebug')).toBeTruthy();
    expect(await screen.findByText(/keep-me/)).toBeTruthy();
  });

  it('并行多轮：可切换查看每一轮详情，账号显示昵称不裸 id（2026-07-09 用户反馈）', async () => {
    state.published = { items: [] };
    state.accounts = {
      accounts: [{ accountId: 'acc-1', nickname: '小红薯甲', label: null } as unknown],
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

    renderPage();

    // 默认跟随最新启动的一轮（r2）。
    expect(await screen.findByText('乙稿标题')).toBeTruthy();
    // 账号显示昵称（草稿事实 + 阶段 fact 多处），绝不裸 id。
    expect(screen.getAllByText('账号 小红薯甲').length).toBeGreaterThan(0);
    expect(screen.queryByText(/账号 acc-1/)).toBeNull();
    // 切到第一轮（Segmented 首个选项）→ 详情换成甲稿。
    fireEvent.click(screen.getAllByText(/小红薯甲 · 洗稿/)[0]);
    expect(await screen.findByText('甲稿标题')).toBeTruthy();
  });

  it('新 cloud 生命周期优先展示八阶段，并保留原始快照排障入口', async () => {
    state.published = { items: [] };
    state.accounts = { accounts: [{ accountId: 'acc-1', nickname: 'Tmax', label: null } as unknown] };
    state.queue = {
      status: 'running',
      snapshot: null,
      lifecycle: { status: 'running', active: [journey()], recent: [] },
    };

    renderPage();

    expect(await screen.findByText('执行中')).toBeTruthy();
    expect(screen.getByText('八阶段测试稿件')).toBeTruthy();
    expect(screen.getByText('Tmax')).toBeTruthy();
    for (const label of lifecycleStageLabels) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('洗稿/正文')).toBeNull();

    fireEvent.click(screen.getByText(/原始字段/));
    expect(await screen.findByText('customDebug')).toBeTruthy();
    expect(screen.getByText(/lifecycle-raw/)).toBeTruthy();
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
    renderPage();

    expect((await screen.findAllByText('等待人工')).length).toBeGreaterThan(0);
    expect(screen.getByText('等待审批')).toBeTruthy();
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
    renderPage();

    expect(await screen.findByText('平台下发中')).toBeTruthy();
    expect(screen.getByText('平台下发')).toBeTruthy();
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
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
    renderPage();

    expect(await screen.findByText('无活跃稿件')).toBeTruthy();
    expect(screen.getByText('最近结果 · 失败')).toBeTruthy();
    expect(screen.getByText('平台下发失败，未确认发布')).toBeTruthy();
    expect(screen.queryByText('活跃稿件')).toBeNull();
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
