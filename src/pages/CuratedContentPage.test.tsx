/**
 * 精选页行级定向动作前端测试（change curated-note-actions）。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染与调用路径。
 * 断言：按钮禁用态（视频/评论行禁洗稿、评论行动作全禁、历史壳行禁洗稿）、两端点调用参数（按行账号路由 + withContact）、
 * 触发态回执诚实分支（triggered 才绿；域内拒绝呈现说人话中文、绝不染绿）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CuratedContentPage } from './CuratedContentPage';
import { apiPost } from '../api/client';
import type { DelegatedTaskDraftReceipt, PanelCuratedContent } from '../types/api';

// jsdom 无 matchMedia / ResizeObserver；antd Table/Select/Modal（rc-*）依赖，给最小桩。
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

function makeRow(overrides: Partial<PanelCuratedContent> = {}): PanelCuratedContent {
  return {
    id: 7,
    accountId: 'acc-1',
    contentType: 'image_text',
    sourceId: 'note-42',
    title: '目标笔记标题',
    body: '正文内容',
    author: '博主甲',
    sourceUrl: null,
    topics: [],
    likeCount: 10,
    collectCount: 5,
    commentCount: null,
    countsCapturedAt: null,
    botLiked: false,
    botCollected: true,
    admitReason: 'bot_collect',
    firstSeenAt: 1,
    updatedAt: 2,
    referenceImages: [],
    ...overrides,
  };
}

function taskReceipt(action = 'publish_post'): DelegatedTaskDraftReceipt {
  return {
    created: true,
    task: {
      id: `task-${action}`, accountId: 'acc-1', accountName: '小萝北', platform: 'xiaohongshu', action,
      targetSuccessCount: 1, maxAttempts: 2, deadlineAt: Date.now() + 60_000, approvalMode: 'review',
      priority: 'normal', status: 'awaiting_confirmation', progress: { successCount: 0, attemptCount: 0, skippedCount: 0, failureCount: 0 }, version: 1,
    },
    confirmation: {
      taskId: `task-${action}`, version: 1, title: '请确认用户委托任务', accountName: '小萝北',
      platformLabel: '小红书', actionLabel: action === 'comment_curated' ? '评论指定精选内容' : '发布一篇稿件',
      target: '1 个验证成功结果', attempts: '最多 2 次尝试', schedule: '确认后排队', approval: '公开写操作保留人审',
      priority: '普通', constraints: ['目标已锁定'], capability: 'supported',
    },
  };
}

const state = vi.hoisted(() => ({
  items: [] as unknown[],
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    apiGet: vi.fn((path: string) => {
      if (path.startsWith('/api/accounts')) return Promise.resolve({ accounts: [] });
      if (path.startsWith('/api/curated/facets')) {
        return Promise.resolve({ admitReasons: [], imageTextCount: 1, videoCount: 1, noteCount: 2, commentCount: 1 });
      }
      if (path.startsWith('/api/curated/contents')) return Promise.resolve({ items: state.items, total: state.items.length });
      return Promise.reject(new Error(`unexpected apiGet ${path}`));
    }),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
  };
});

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <CuratedContentPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>,
  );
}

describe('CuratedContentPage 行级定向动作（change curated-note-actions）', () => {
  beforeEach(() => {
    state.items = [
      makeRow(), // id7：图文 + 有正文 → 两动作可用
      makeRow({ id: 8, contentType: 'video', title: '目标视频标题', body: '视频文案' }), // 视频行 → 禁洗稿、可评论
      makeRow({ id: 9, contentType: 'comment', title: '一条精选评论', body: '评论文本' }), // 评论行 → 两动作全禁
      makeRow({ id: 10, title: '壳行图文', body: '' }), // 历史壳行 → 禁洗稿、可评论
    ];
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPost).mockImplementation((path: string) => Promise.resolve(
      path.includes('/confirm') ? { task: { ...taskReceipt().task, status: 'queued', version: 2 } }
        : taskReceipt(path.endsWith('/comment') ? 'comment_curated' : 'publish_post'),
    ));
  });

  it('按钮禁用态：视频/评论禁洗稿；评论行全禁；历史壳行禁洗稿但可评论', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    const createBtns = screen.getAllByRole('button', { name: /洗\s*稿/ });
    const commentBtns = screen.getAllByRole('button', { name: /评\s*论/ });
    expect(createBtns.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, true, true, true]);
    expect(commentBtns.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true, false]);
  });

  it('不展示空正文批量清理入口', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    expect(screen.queryByText('历史清理')).toBeNull();
    expect(screen.queryByRole('button', { name: /清理/ })).toBeNull();
    expect(vi.mocked(apiPost).mock.calls.some(([path]) => String(path).includes('/clear-empty'))).toBe(false);
  });

  it('洗稿先创建 awaiting_confirmation；用户二次确认后才排队', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /生成确认/ }));
    expect(await screen.findByText('请确认用户委托任务')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/create-post', { accountId: 'acc-1' });
    expect(vi.mocked(apiPost)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /确认并排队/ }));
    expect(await screen.findByText(/这不是平台成功回执/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/delegated-tasks/task-publish_post/confirm', { version: 1 });
  });

  it('带参考图的洗稿先弹参考模式；切到仅文本后发送 useReferenceImages:false', async () => {
    state.items = [
      makeRow({
        referenceImages: [
          {
            index: 0,
            sourceUrl: 'https://img.test/source.jpg',
            ossUrl: 'https://oss.test/source.jpg',
            alt: 'reference cover',
            captureStatus: 'stored',
            capturedAt: 1,
          },
        ],
      }),
    ];
    renderPage();
    expect(await screen.findByAltText('reference cover')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /洗稿/ }));
    fireEvent.click(await screen.findByRole('button', { name: /生成确认/ }));

    expect(await screen.findByText('带图参考')).toBeTruthy();
    const imageMode = screen.getByLabelText('带图参考') as HTMLInputElement;
    expect(imageMode.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('仅文本参考'));
    fireEvent.click(screen.getByRole('button', { name: /生成确认/ }));

    expect(await screen.findByText('请确认用户委托任务')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/create-post', {
      accountId: 'acc-1',
      useReferenceImages: false,
    });
  });

  it('任务草稿创建失败时不出现确认卡，也不显示排队成功', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('生成并发已满，请稍后再试'));
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /生成确认/ }));
    expect(await screen.findByText(/委托草稿创建失败/)).toBeTruthy();
    expect(screen.queryByText('请确认用户委托任务')).toBeNull();
  });

  it('确认卡锁定账号、动作、成功目标与尝试上限', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /生成确认/ }));
    await screen.findByText('请确认用户委托任务');
    const dialog = screen.getAllByRole('dialog').at(-1)!;
    expect(within(dialog).getByText('小萝北')).toBeTruthy();
    expect(within(dialog).getByText('发布一篇稿件')).toBeTruthy();
    expect(within(dialog).getByText('1 个验证成功结果')).toBeTruthy();
    expect(within(dialog).getByText('最多 2 次尝试')).toBeTruthy();
  });

  it('阅读详情浮层里可以触发洗稿', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('目标笔记标题'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /洗\s*稿/ }));
    fireEvent.click(await screen.findByRole('button', { name: /生成确认/ }));
    expect(await screen.findByText('请确认用户委托任务')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/create-post', { accountId: 'acc-1' });
  });

  it('查看笔记详情里的参考图点击打开站内预览浮层，不渲染原图链接或下载目标', async () => {
    state.items = [
      makeRow({
        referenceImages: [
          {
            index: 0,
            sourceUrl: 'https://img.test/one.jpg',
            ossUrl: 'https://oss.test/one.jpg',
            alt: 'first reference',
            captureStatus: 'stored',
            capturedAt: 1,
          },
          {
            index: 1,
            sourceUrl: 'https://img.test/two.jpg',
            ossUrl: 'https://oss.test/two.jpg',
            alt: 'second reference',
            captureStatus: 'stored',
            capturedAt: 1,
          },
        ],
      }),
    ];

    renderPage();
    fireEvent.click(await screen.findByText('目标笔记标题'));
    const detail = await screen.findByRole('dialog');

    expect(detail.querySelector('a[href="https://oss.test/one.jpg"]')).toBeNull();
    expect(detail.querySelector('a[href="https://oss.test/two.jpg"]')).toBeNull();
    expect(detail.querySelector('[download]')).toBeNull();

    const detailImageButtons = within(detail).getAllByRole('button', { name: /预览参考图/ });
    fireEvent.click(detailImageButtons[1]);

    expect(await screen.findByText('参考图 2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /下一张/ }));
    expect(await screen.findByText('参考图 1/2')).toBeTruthy();
  });

  it('详情按非摄影类型展示专用视觉反推维度，不冒充相机参数', async () => {
    state.items = [makeRow({
      visualAnalysis: {
        status: 'analyzed', schemaVersion: 'visual-reference-v1', cacheKey: 'k', provider: 'dashscope', model: 'qwen3.7-plus', analyzedAt: 10, sourceCount: 1,
        setStyleBible: { summary: '克制的蓝灰界面视觉', palette: ['蓝灰'], colorTemperature: 'cool', contrast: 'medium', visualDensity: 'balanced', whitespace: '适中', hierarchy: '清楚', mood: ['理性'], texture: ['干净'], continuityRules: ['统一'], avoid: ['水印'] },
        styleClusters: [{ id: 'c1', label: '蓝灰界面', frameIndexes: [0], summary: '统一', palette: ['蓝灰'], traits: ['克制'] }],
        frameSpecs: [{
          sourceArrayIndex: 0, sourceIndex: 0, kind: 'ui_document', confidence: 0.93, clusterId: 'c1', sequenceRole: 'cover',
          common: { aspectRatio: '3:4', subject: '移动端界面结构', composition: '单列', focalHierarchy: '顶栏与内容区', palette: ['蓝灰'], lightingOrContrast: '中对比', negativeSpace: '边缘留白', texture: '干净', mood: '理性', avoid: ['具体文字'] },
          details: { family: 'ui_document', viewport: '移动端竖屏', grid: '单列网格', componentDensity: '中等', bordersRadius: '小圆角', informationZones: '顶栏/内容区/底栏', depth: '浅层级', background: '浅灰' },
        }],
      },
    })];
    renderPage();
    fireEvent.click(await screen.findByText('目标笔记标题'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('克制的蓝灰界面视觉')).toBeTruthy();
    fireEvent.click(within(dialog).getByText(/源图 1 · 界面\/文档/));
    expect(await within(dialog).findByText('viewport：移动端竖屏')).toBeTruthy();
    expect(within(dialog).queryByText(/focalLength|焦距|相机型号/)).toBeNull();
  });

  it('评论：选择「联系评论」后先生成结构化确认，参数保留 withContact:true', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标源帖');
    fireEvent.click(screen.getByText('联系评论'));
    fireEvent.click(screen.getByRole('button', { name: /生成确认/ }));
    expect(await screen.findByText('请确认用户委托任务')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withContact: true,
    });
  });

  it('评论确认后进入队列，不把触发态写成评论成功', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标源帖');
    fireEvent.click(screen.getByRole('button', { name: /生成确认/ }));
    await screen.findByText('请确认用户委托任务');
    fireEvent.click(screen.getByRole('button', { name: /确认并排队/ }));
    expect(await screen.findByText(/这不是平台成功回执/)).toBeTruthy();
    expect(screen.queryByText(/已触发评论/)).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withContact: false,
    });
  });
});
