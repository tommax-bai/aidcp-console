/**
 * FacebookSearchConfig（change facebook-scheduled-comment 2.1）核心交互回归：
 *  - 点开「FB配置」→ apiGet 拉当前配置（正确 path）并回填。
 *  - 保存 → apiPut 到同一 path，body = { keywords, commentMode, commentTemplates }。
 *  - legacy containers 不再展示 / 不再提交。
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
      commentMode: 'generated',
      commentTemplates: [],
      updatedAt: null,
      updatedBy: null,
    };
    state.getCalls = [];
    state.putCalls = [];
  });

  it('点开时回填关键词和评论方式；legacy 群组不再展示', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() =>
      expect(state.getCalls).toContain('/api/accounts/fb-1/facebook-comment-config'),
    );
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    expect(screen.getByText('生成评论')).toBeTruthy();
    expect(screen.getByText('模板评论')).toBeTruthy();
    // 群组已从账号 FB 配置中移除，即使接口仍返回 legacy containers，也不展示给运营。
    expect(screen.queryByText('Puerto Rico Y Sus Encantos e Historia')).toBeNull();
    expect(screen.queryByText('待识别')).toBeNull();
    expect(screen.queryByText('https://www.facebook.com/groups/123')).toBeNull();
  });

  // 注：「关键词含空格不被拆词」是 AntD tags 输入 tokenSeparators 去掉空格后的行为——其 CJK 分词依赖
  //   composition/输入事件序列，jsdom 下靠 fireEvent 无法稳定复现（会误判未创建标签）。该行为转真机验收（簇 49）。

  it('保存生成评论配置 → apiPut body 不再提交 containers', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].path).toBe('/api/accounts/fb-1/facebook-comment-config');
    expect(state.putCalls[0].body).toEqual({
      keywords: ['手冲咖啡'],
      commentMode: 'generated',
      commentTemplates: [],
    });
  });

  it('模板评论：回填模板，保存时按行 sanitize/去重', async () => {
    state.cfg = {
      ...state.cfg,
      commentMode: 'template',
      commentTemplates: ['这家手冲咖啡很不错', '这家烘焙咖啡很不错'],
    };
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() => expect(screen.getByDisplayValue(/这家手冲咖啡很不错/)).toBeTruthy());
    const textarea = screen.getByDisplayValue(/这家手冲咖啡很不错/) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: ' 这家手冲咖啡很不错 \n\n这家手冲咖啡很不错\n这家拉花咖啡很不错 ',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].body).toEqual({
      keywords: ['手冲咖啡'],
      commentMode: 'template',
      commentTemplates: ['这家手冲咖啡很不错', '这家拉花咖啡很不错'],
    });
  });
});
