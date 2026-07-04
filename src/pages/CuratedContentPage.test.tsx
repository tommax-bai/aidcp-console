/**
 * 精选页行级定向动作前端测试（change curated-note-actions）。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染与调用路径。
 * 断言：按钮禁用态（评论行两动作全禁、壳行禁洗稿）、两端点调用参数（按行账号路由 + withGroup）、
 * 触发态回执诚实分支（triggered 才绿；域内拒绝呈现说人话中文、绝不染绿）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    contentType: 'note',
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
      if (path.startsWith('/api/curated/facets')) return Promise.resolve({ admitReasons: [], noteCount: 1, commentCount: 0 });
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
      makeRow(), // id7：笔记 + 有正文 → 两动作可用
      makeRow({ id: 8, contentType: 'comment', title: '一条精选评论', body: '评论文本' }), // 评论行 → 全禁
      makeRow({ id: 9, title: '壳行笔记', body: '' }), // 壳行 → 禁洗稿、可评论
    ];
    vi.mocked(apiPost).mockReset();
  });

  it('按钮禁用态：评论行两动作全禁；壳行禁洗稿但可评论', async () => {
    renderPage();
    await screen.findByText('目标笔记标题');
    const createBtns = screen.getAllByRole('button', { name: /洗\s*稿/ });
    const commentBtns = screen.getAllByRole('button', { name: /评\s*论/ });
    expect(createBtns.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, true, true]);
    expect(commentBtns.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, true, false]);
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

  it('洗稿域内拒绝（publish_busy）→ 中文原因、绝不染绿', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: false, reason: 'publish_busy' });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /洗\s*稿/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /触\s*发\s*洗\s*稿/ }));
    expect(await screen.findByText(/发布链路正在生成其它草稿/)).toBeTruthy();
    expect(screen.queryByText(/已触发洗稿/)).toBeNull();
  });

  it('评论：弹窗选「带群评论」→ POST comment 带 withGroup:true；未配群码拒绝呈现中文', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: false, reason: 'group_code_missing' });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标笔记');
    fireEvent.click(screen.getByText('带群评论'));
    fireEvent.click(screen.getByRole('button', { name: /触\s*发\s*评\s*论|触发评论/ }));
    expect(await screen.findByText(/未配置「关联群聊信息」/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withGroup: true,
    });
  });

  it('评论触发成功 → 提示人审与结果卡、弹窗关闭', async () => {
    vi.mocked(apiPost).mockResolvedValue({ triggered: true });
    renderPage();
    await screen.findByText('目标笔记标题');
    fireEvent.click(screen.getAllByRole('button', { name: /评\s*论/ })[0]);
    await screen.findByText('目标笔记');
    fireEvent.click(screen.getByRole('button', { name: /触\s*发\s*评\s*论|触发评论/ }));
    expect(await screen.findByText(/已触发评论/)).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/curated/contents/7/comment', {
      accountId: 'acc-1',
      withGroup: false,
    });
  });
});
