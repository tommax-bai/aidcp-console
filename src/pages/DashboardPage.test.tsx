/**
 * change dashboard-refresh-clarity：看板可读性——「数据截至 asOf / 自动刷新中」新鲜度标识 +
 * edgesOnline=0 时「系统当前未在浏览，故无新数据」提示。只 mock HTTP 客户端层，
 * 页面 + react-query 走真实渲染路径；诚实呈现：有边缘在线时绝不显示无活动提示。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage';
import type { DashboardSummary } from '../types/api';

// jsdom 无 matchMedia；antd 响应式（Row gutter / Grid）需要最小桩。
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

const state = vi.hoisted(() => ({ summary: undefined as unknown }));

vi.mock('../api/client', () => ({
  apiGet: vi.fn((path: string) => {
    if (path === '/api/dashboard/summary') return Promise.resolve(state.summary);
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPost: vi.fn(() => Promise.reject(new Error('no writes expected in this test'))),
}));

const AS_OF = new Date('2026-07-03T10:20:30').getTime();

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    asOf: AS_OF,
    edgesOnline: 0,
    totals: { view: 0, like: 0, collect: 0, comment: 0, follow: 0, publish: 0, comment_like: 0 },
    totalsByAccount: [],
    likeRate: { likes: 0, views: 0, rate: null, healthy: null },
    accounts: [],
    alerts: [],
    attributionPending: false,
    dispatchActive: null,
    ...overrides,
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

describe('DashboardPage 新鲜度与无活动提示（change dashboard-refresh-clarity）', () => {
  beforeEach(() => {
    state.summary = makeSummary();
  });

  it('呈现「数据截至 asOf / 自动刷新中」新鲜度标识', async () => {
    renderPage();
    const expectedTime = new Date(AS_OF).toLocaleTimeString('zh-CN', { hour12: false });
    expect(await screen.findByText(`数据截至 ${expectedTime}`)).toBeTruthy();
    expect(screen.getByText('自动刷新中')).toBeTruthy();
  });

  it('edgesOnline=0 时如实提示「系统当前未在浏览，故无新数据」', async () => {
    renderPage();
    expect(await screen.findByText(/系统当前未在浏览/)).toBeTruthy();
  });

  it('有边缘在线时不显示无活动提示（诚实呈现，不误报故障）', async () => {
    state.summary = makeSummary({ edgesOnline: 2 });
    renderPage();
    // 等页面数据渲染完（新鲜度标识出现）再断言提示缺席。
    await screen.findByText('自动刷新中');
    expect(screen.queryByText(/系统当前未在浏览/)).toBeNull();
  });
});
