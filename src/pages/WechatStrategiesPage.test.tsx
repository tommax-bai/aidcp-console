import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { panelAccount } from '../test/fixtures/interactionReplyConfig';
import { WechatStrategiesPage } from './WechatStrategiesPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('WechatStrategiesPage', () => {
  it('lists the singleton default and exact group scopes with fail-closed copy', async () => {
    const grouped = { ...panelAccount('acct_group'), groupLabel: '华东组' };
    const ungrouped = { ...panelAccount('acct_default'), groupLabel: null };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/accounts') return json({ accounts: [grouped, ungrouped] });
      if (path === '/api/interaction-reply-config-scopes') return json({
        data: { items: [
          {
            scopeId: 'scope_default', platform: 'wechat_channels', source: { type: 'default', groupLabel: null },
            memberCount: 1, currentVersion: 2, draftVersion: null, publishedVersion: 2,
            updatedAt: 1784044800000, updatedBy: 'admin',
          },
          {
            scopeId: null, platform: 'wechat_channels', source: { type: 'group', groupLabel: '华东组' },
            memberCount: 1, currentVersion: 0, draftVersion: null, publishedVersion: null,
            updatedAt: null, updatedBy: null,
          },
        ] },
        meta: { requestId: 'scope-list', asOf: 1784044800000 },
      });
      throw new Error(`unexpected request ${path}`);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <WechatStrategiesPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>,
    );

    expect(await screen.findByText('默认策略（未分组账号）')).toBeTruthy();
    expect(screen.getByText('分组：华东组')).toBeTruthy();
    expect(screen.getByText(/分组策略缺失时会停止生成\/发送，不会借用默认策略/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建策略' })).toBeTruthy();
    expect(screen.getByText('已发布 v2')).toBeTruthy();
  });
});
