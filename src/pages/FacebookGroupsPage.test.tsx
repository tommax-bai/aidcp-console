import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../api/client', () => ({
  apiGet: mocks.get,
  apiPut: mocks.put,
  apiPost: mocks.post,
  apiPatch: mocks.patch,
}));

vi.mock('../api/queries', () => ({
  useDashboardSummary: () => ({ data: { accounts: [] }, isLoading: false }),
}));

const target = {
  groupUrl: 'https://www.facebook.com/groups/123',
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
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/facebook/groups?')) return Promise.resolve({ items: [target], total: 1 });
      if (path === '/api/facebook/groups/facets') {
        return Promise.resolve({
          regions: [{ region: '北宁区域', parks: [] }],
          directions: [],
          accountGroupLabels: ['越南销售一组', '越南销售二组'],
          unscopedTargetCount: 1,
        });
      }
      if (path === '/api/facebook/groups/progress') return Promise.resolve({ accounts: [] });
      if (path === '/api/facebook/groups/assignments?limit=100') return Promise.resolve({ assignments: [] });
      return Promise.reject(new Error(`unexpected apiGet ${path}`));
    });
    mocks.put.mockResolvedValue({
      items: [
        {
          groupUrl: target.groupUrl,
          accountGroupLabels: ['越南销售一组'],
          updatedAt: '2026-07-22T01:00:00.000Z',
          updatedBy: 'operator',
        },
      ],
    });
    mocks.post.mockResolvedValue({ imported: 1, updated: 0, duplicate: 0, invalid: 0, rows: [target] });
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
        accountGroupLabels: ['越南销售一组', '越南销售二组'],
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
  });
});
