/**
 * FacebookSearchConfig（change facebook-scheduled-comment 2.1）核心交互回归：
 *  - 点开「配置搜索词」→ apiGet 拉当前配置（正确 path）并回填。
 *  - 保存 → apiPut 到同一 path，body = { keywords, containers }（回填值原样提交）。
 * 只 mock HTTP 客户端层，组件 + react-query 走真实路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FacebookSearchConfig } from './FacebookSearchConfig';
import type { FacebookCommentConfig, PanelAccount } from '../types/api';

// jsdom 未实现 getComputedStyle 的伪元素形态（AntD Modal 量滚动条会传第二参 → 抛错打断 footer 渲染）。丢弃第二参。
const origGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) => origGetComputedStyle(elt)) as typeof window.getComputedStyle;

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

const state = vi.hoisted(() => ({
  cfg: {} as FacebookCommentConfig,
  getCalls: [] as string[],
  putCalls: [] as Array<{ path: string; body: unknown }>,
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    return Promise.resolve(state.cfg);
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    return Promise.resolve(state.cfg);
  }),
}));

function fbAccount(): PanelAccount {
  return {
    accountId: 'fb-1',
    label: 'FB One',
    nickname: null,
    platform: 'facebook',
    groupLabel: null,
    machineLabel: null,
    groupChatInfo: null,
    operatorStatus: 'active',
    pausedAt: null,
    riskStatus: null,
    riskQuotaLevel: null,
    signalCount: null,
    personaBound: true,
    needsPersonaSetup: false,
  };
}

function renderCmp(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <AntdApp>
      <QueryClientProvider client={qc}>
        <FacebookSearchConfig account={fbAccount()} />
      </QueryClientProvider>
    </AntdApp>,
  );
}

describe('FacebookSearchConfig', () => {
  beforeEach(() => {
    state.cfg = { accountId: 'fb-1', keywords: ['手冲咖啡'], containers: ['group-123'], updatedAt: null, updatedBy: null };
    state.getCalls = [];
    state.putCalls = [];
  });

  it('点开时以正确 path 拉配置并回填（显示已有关键词/容器标签）', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('配置搜索词'));
    await waitFor(() =>
      expect(state.getCalls).toContain('/api/accounts/fb-1/facebook-comment-config'),
    );
    // 回填的关键词/容器作为 tag 出现在弹层里
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    expect(screen.getByText('group-123')).toBeTruthy();
  });

  it('保存 → apiPut 到同一 path，body 为回填的 { keywords, containers }', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('配置搜索词'));
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].path).toBe('/api/accounts/fb-1/facebook-comment-config');
    expect(state.putCalls[0].body).toEqual({ keywords: ['手冲咖啡'], containers: ['group-123'] });
  });
});
