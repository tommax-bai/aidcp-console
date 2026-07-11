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
    contactInfo: null,
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
    state.cfg = {
      accountId: 'fb-1',
      keywords: ['手冲咖啡'],
      // 已识别群名 + 一个待识别（只有 url）的容器。
      containers: [
        { url: 'https://www.facebook.com/groups/123', name: 'Puerto Rico Y Sus Encantos e Historia' },
        { url: 'https://www.facebook.com/groups/456' },
      ],
      updatedAt: null,
      updatedBy: null,
    };
    state.getCalls = [];
    state.putCalls = [];
  });

  it('点开时回填：容器标签展示群名（缺则「待识别」），绝不展示群 id', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() =>
      expect(state.getCalls).toContain('/api/accounts/fb-1/facebook-comment-config'),
    );
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    // 展示真实群名，未识别的显示「待识别」。
    expect(screen.getByText('Puerto Rico Y Sus Encantos e Historia')).toBeTruthy();
    expect(screen.getByText('待识别')).toBeTruthy();
    // 绝不把群 id / url 直接展示给人（标签里不出现裸群号）。
    expect(screen.queryByText('123')).toBeNull();
    expect(screen.queryByText('https://www.facebook.com/groups/123')).toBeNull();
  });

  // 注：「关键词含空格不被拆词」是 AntD tags 输入 tokenSeparators 去掉空格后的行为——其 CJK 分词依赖
  //   composition/输入事件序列，jsdom 下靠 fireEvent 无法稳定复现（会误判未创建标签）。该行为转真机验收（簇 49）。

  it('保存 → apiPut body 保留已识别群名（改关键词不丢名）', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].path).toBe('/api/accounts/fb-1/facebook-comment-config');
    expect(state.putCalls[0].body).toEqual({
      keywords: ['手冲咖啡'],
      containers: [
        { url: 'https://www.facebook.com/groups/123', name: 'Puerto Rico Y Sus Encantos e Historia' },
        { url: 'https://www.facebook.com/groups/456' },
      ],
    });
  });
});
