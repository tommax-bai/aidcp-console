/**
 * change console-cloud-panel-hardening #32：内容审批 CAS 链前端测试。
 * 只 mock HTTP 客户端层（apiGet/apiPost/apiPut），页面 + react-query 走真实渲染与调用路径；
 * 断言拒因经 errorText（#31）呈现为**说人话中文**、绝不把英文机器码（version_stale 等）直接上屏。
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
import { ContentPage } from './ContentPage';
import { ApiError, apiPost, apiPut } from '../api/client';
import type { PanelPublish } from '../types/api';

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
  queue: { status: 'idle', snapshot: null } as { status: string; snapshot: unknown },
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
    ...overrides,
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
  await screen.findByText('保存草稿');
}

describe('ContentPage 审批 CAS 链（change console-cloud-panel-hardening #32）', () => {
  beforeEach(() => {
    state.published = { items: [makePending()] };
    state.queue = { status: 'idle', snapshot: null };
    state.accounts = { accounts: [] };
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it('保存草稿成功 → 「已保存」提示，抽屉保持打开', async () => {
    vi.mocked(apiPut).mockResolvedValue({
      recordId: 1,
      contentVersion: 1,
      title: '测试草稿标题',
      content: '正文内容',
    });
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('已保存')).toBeTruthy();
    // 保存成功不关抽屉（viewing 未清空）：底部按钮仍在。
    expect(screen.getByText('保存草稿')).toBeTruthy();
    // 携带打开时快照版本做 CAS（expectedVersion=0）。
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/publish/1/draft', {
      expectedVersion: 0,
      title: '测试草稿标题',
      content: '正文内容',
    });
  });

  it('版本冲突（version_stale）→ 呈现中文拒因、绝不上屏英文码', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'version_stale'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('内容已更新，请刷新后重新审批')).toBeTruthy();
    expect(screen.queryByText('version_stale')).toBeNull();
  });

  it('版本冲突（version_conflict）→ 中文拒因', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'version_conflict'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('内容已被他处修改，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
  });

  it('already_decided → 中文拒因', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'already_decided'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('该草稿正在审批处理中，请刷新')).toBeTruthy();
    expect(screen.queryByText('already_decided')).toBeNull();
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
  });

  it('保存并批准 → 先编辑(CAS) 再按快照版本授权发布', async () => {
    vi.mocked(apiPut).mockResolvedValue({
      recordId: 1,
      contentVersion: 1,
      title: '测试草稿标题',
      content: '正文内容',
    });
    vi.mocked(apiPost).mockResolvedValue({ written: true });
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '保存并批准' }));
    // Popconfirm 确认（zhCN → 「确定」；antd 会在两个中文字间插空格 → 用 /确\s*定/ 容差匹配）。
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(await screen.findByText('已授权发布')).toBeTruthy();
    // 授权携带编辑回读后的内容版本快照（「审=发」凭证），requestId 由记录 id 派生。
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/publish/publish-1/approve', {
      approved: true,
      contentVersion: 1,
    });
  });
});
