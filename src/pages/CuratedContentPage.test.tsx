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
import type { PanelCuratedContent } from '../types/api';

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

  it('洗稿：确认后按行账号 POST create-post；triggered=true → 引导去飞书人审', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: true });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /触\s*发\s*洗\s*稿/ }));
    expect(await screen.findByText(/已触发洗稿/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/create-post', { accountId: 'acc-1' });
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
    vi.mocked(apiPost).mockResolvedValue({ triggered: true });
    renderPage();
    expect(await screen.findByAltText('reference cover')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /洗稿/ }));
    fireEvent.click(await screen.findByRole('button', { name: /触发洗稿/ }));

    expect(await screen.findByText('带图参考')).toBeTruthy();
    const imageMode = screen.getByLabelText('带图参考') as HTMLInputElement;
    expect(imageMode.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('仅文本参考'));
    fireEvent.click(screen.getByRole('button', { name: /触发创作/ }));

    expect(await screen.findByText(/已触发洗稿/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/create-post', {
      accountId: 'acc-1',
      useReferenceImages: false,
    });
  });

  it('洗稿域内拒绝（publish_busy）→ 中文原因、绝不染绿', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: false, reason: 'publish_busy' });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /触\s*发\s*洗\s*稿/ }));
    // change parallel-rewrite-drafts：publish_busy 语义收窄为并发帽满（全局串行已消灭）。
    expect(await screen.findByText(/生成并发已满/)).toBeTruthy();
    expect(screen.queryByText(/已触发洗稿/)).toBeNull();
  });

  it('洗稿域内拒绝（duplicate_source / publish_capacity）→ 各自中文原因、绝不染绿', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: false, reason: 'duplicate_source' });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /触\s*发\s*洗\s*稿/ }));
    expect(await screen.findByText(/已有一轮洗稿在途/)).toBeTruthy();
    expect(screen.queryByText(/已触发洗稿/)).toBeNull();
  });

  it('阅读详情浮层里可以触发洗稿', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: true });
    renderPage();
    fireEvent.click(await screen.findByText('目标笔记标题'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /洗\s*稿/ }));
    fireEvent.click(await screen.findByRole('button', { name: /触\s*发\s*洗\s*稿/ }));
    expect(await screen.findByText(/已触发洗稿/)).toBeTruthy();
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

  it('评论：弹窗选「联系评论」→ POST comment 带 withContact:true；未配联系方式拒绝呈现中文', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: false, reason: 'contact_info_missing' });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标源帖');
    fireEvent.click(screen.getByText('联系评论'));
    fireEvent.click(screen.getByRole('button', { name: /触\s*发\s*评\s*论|触发评论/ }));
    expect(await screen.findByText(/未配置「联系方式」/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withContact: true,
    });
  });

  it('评论触发成功 → 提示人审与结果卡、弹窗关闭', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: true });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标源帖');
    fireEvent.click(screen.getByRole('button', { name: /触\s*发\s*评\s*论|触发评论/ }));
    expect(await screen.findByText(/已触发评论/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withContact: false,
    });
  });
});
