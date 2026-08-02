import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FacebookGroupsPage } from './FacebookGroupsPage';

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

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => getComputedStyle(element);

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../api/client', () => {
  class ApiError extends Error {
    reason?: string;
  }
  return {
    ApiError,
    apiGet: mocks.get,
    apiPut: mocks.put,
    apiPost: mocks.post,
    apiPatch: mocks.patch,
  };
});

vi.mock('../api/queries', () => ({
  useDashboardSummary: () => ({ data: { accounts: [] }, isLoading: false }),
}));

const target = {
  groupUrl: 'https://www.facebook.com/groups/123',
  accountScopeMode: 'restricted' as 'restricted' | 'global',
  accountGroupLabels: [] as string[],
  groupName: '越南工业群',
  region: '北宁区域',
  park: null,
  direction: null,
  joinGating: 'instant' as const,
  priority: 1,
  enabled: true,
  importBatch: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  accountId: null,
  membershipStatus: null,
  joinedAt: null,
  lastAttemptAt: null,
  lastReason: null,
  lastCommentedAt: null,
  commentsTotal: 0,
};

async function chooseOption(controlName: string, optionLabel: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: controlName }));
  fireEvent.click(await screen.findByText(optionLabel, { selector: '.ant-select-item-option-content' }));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <FacebookGroupsPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

describe('FacebookGroupsPage 账号分组范围', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.post.mockReset();
    mocks.patch.mockReset();
    target.accountScopeMode = 'restricted';
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/facebook/groups?')) return Promise.resolve({ items: [target], total: 1 });
      if (path === '/api/facebook/groups/facets') {
        return Promise.resolve({
          regions: [{ region: '北宁区域', parks: [] }],
          directions: [],
          accountGroupLabels: ['越南销售一组', '越南销售二组'],
          globalTargetCount: 2,
          unscopedTargetCount: 1,
        });
      }
      if (path === '/api/facebook/groups/comment-templates') {
        return Promise.resolve({
          items: [{
            region: '北宁区域',
            commentTemplates: ['区域咖啡欢迎语'],
            updatedAt: '2026-07-27T08:00:00.000Z',
            updatedBy: 'operator',
          }],
        });
      }
      if (path === '/api/facebook/groups/progress') return Promise.resolve({ accounts: [] });
      if (path === '/api/facebook/groups/assignments?limit=100') return Promise.resolve({ assignments: [] });
      return Promise.reject(new Error(`unexpected apiGet ${path}`));
    });
    mocks.put.mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path === '/api/facebook/groups/comment-templates') {
        return Promise.resolve({
          ...body,
          updatedAt: '2026-07-27T09:00:00.000Z',
          updatedBy: 'operator',
        });
      }
      return Promise.resolve({
        items: [
          {
            groupUrl: target.groupUrl,
            accountScopeMode: body.accountScopeMode ?? 'restricted',
            accountGroupLabels: body.accountGroupLabels ?? ['越南销售一组'],
            updatedAt: '2026-07-22T01:00:00.000Z',
            updatedBy: 'operator',
          },
        ],
      });
    });
    mocks.post.mockResolvedValue({ imported: 1, updated: 0, duplicate: 0, invalid: 0, rows: [target] });
  });

  it('does not retain a duplicate join-to-first-comment timing editor', async () => {
    renderPage();

    expect(await screen.findByText('Facebook 群组')).not.toBeNull();
    expect(screen.queryByLabelText('入群后首次评论等待（小时）')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalledWith('/api/facebook/groups/comment-policy');
  });

  it('展示未设置范围告警，并用 exact accountGroupLabel 查询', async () => {
    renderPage();

    expect(await screen.findByText('未设置适用分组')).not.toBeNull();
    expect(screen.getByText('有 1 个群组未设置适用账号分组')).not.toBeNull();
    await chooseOption('适用账号分组筛选', '越南销售一组');

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        expect.stringContaining('accountGroupLabel=%E8%B6%8A%E5%8D%97%E9%94%80%E5%94%AE%E4%B8%80%E7%BB%84'),
      ),
    );
  });

  it('展示全局范围真态，并可按全局范围筛选', async () => {
    target.accountScopeMode = 'global';
    renderPage();

    expect((await screen.findAllByText('全局分组')).length).toBeGreaterThan(0);
    await chooseOption('适用范围模式筛选', '全局分组');
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        expect.stringContaining('accountScopeMode=global'),
      ),
    );
  });

  it('对明确选中的群组原子替换多个适用账号分组', async () => {
    renderPage();
    await screen.findByText('越南工业群');

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    await chooseOption('批量适用账号分组', '越南销售一组');
    await chooseOption('批量适用账号分组', '越南销售二组');
    fireEvent.click(screen.getByRole('button', { name: '替换所选群组范围' }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/api/facebook/groups/scopes', {
        groupUrls: [target.groupUrl],
        accountScopeMode: 'restricted',
        accountGroupLabels: ['越南销售一组', '越南销售二组'],
      }),
    );
  });

  it('可把明确选中的群组批量设为全局分组', async () => {
    renderPage();
    await screen.findByText('越南工业群');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    const mode = screen.getByLabelText('批量适用范围模式');
    fireEvent.click(within(mode).getByText('全局分组'));
    fireEvent.click(screen.getByRole('button', { name: '设为全局分组' }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/api/facebook/groups/scopes', {
        groupUrls: [target.groupUrl],
        accountScopeMode: 'global',
        accountGroupLabels: [],
      }),
    );
  });

  it('导入默认省略范围字段，显式开启且留空时发送清空语义', async () => {
    renderPage();
    await screen.findByText('越南工业群');

    const urlInput = screen.getByRole('textbox', { name: '群组 URL' });
    fireEvent.change(urlInput, { target: { value: 'https://www.facebook.com/groups/456' } });
    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const firstBody = mocks.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(firstBody).not.toHaveProperty('accountGroupLabels');

    fireEvent.change(urlInput, { target: { value: 'https://www.facebook.com/groups/457' } });
    fireEvent.click(screen.getByRole('switch', { name: '本次设置适用账号分组' }));
    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenLastCalledWith(
        '/api/facebook/groups/import',
        expect.objectContaining({ accountGroupLabels: [] }),
      ),
    );
    expect(
      (mocks.post.mock.calls.at(-1)?.[1] as Record<string, unknown>)
        .accountScopeMode,
    ).toBe('restricted');
  });

  it('按区域回填并保存通用评论模板', async () => {
    renderPage();
    const textarea = await screen.findByRole('textbox', {
      name: '区域通用评论模板',
    });
    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toBe('区域咖啡欢迎语'),
    );
    // change facebook-comment-template-blocks：块之间用单独一行 ------ 分隔，块内换行属于该模板正文。
    fireEvent.change(textarea, {
      target: { value: '区域咖啡欢迎语\n第二行\n------\n区域咖啡备用语\n------\n区域咖啡欢迎语\n第二行' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存区域模板' }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        '/api/facebook/groups/comment-templates',
        {
          region: '北宁区域',
          commentTemplates: ['区域咖啡欢迎语\n第二行', '区域咖啡备用语'],
        },
      ),
    );
  });

  it('区域模板保存失败时保留草稿并明确报错，不冒充成功', async () => {
    mocks.put.mockImplementation((path: string) => {
      if (path === '/api/facebook/groups/comment-templates') {
        return Promise.reject(new Error('network_down'));
      }
      return Promise.resolve({ items: [] });
    });
    renderPage();
    const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: '区域通用评论模板',
    });
    await waitFor(() => expect(textarea.value).toBe('区域咖啡欢迎语'));
    fireEvent.change(textarea, {
      target: { value: '尚未保存的区域模板' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存区域模板' }));

    expect(
      await screen.findByText('通用评论模板保存失败，未改变原配置'),
    ).toBeTruthy();
    expect(textarea.value).toBe('尚未保存的区域模板');
  });
});
