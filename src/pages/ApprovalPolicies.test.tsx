import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AccountsPage } from './AccountsPage';
import { NotificationRoutesPage } from './NotificationRoutesPage';
import type { ApprovalPolicyCatalog, PanelAccount } from '../types/api';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudo?: string | null): CSSStyleDeclaration => (
  pseudo ? { getPropertyValue: () => '0px' } as unknown as CSSStyleDeclaration : realGetComputedStyle(element)
)) as typeof window.getComputedStyle;

const state = vi.hoisted(() => ({
  putCalls: [] as Array<{ path: string; body: unknown }>,
  policies: { accounts: [], groups: [] } as ApprovalPolicyCatalog,
}));

const account = {
  accountId: 'acc-1', label: '小猫', nickname: '小猫', operatorAlias: null,
  displayName: '小猫', displayNameSource: 'platform_nickname', platform: 'xiaohongshu',
  groupLabel: '运营一组', machineLabel: null, contactInfo: null,
  operatorStatus: 'active', pausedAt: null, riskStatus: null, riskQuotaLevel: null,
  signalCount: null, personaBound: true, needsPersonaSetup: false,
} as PanelAccount;

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    if (path === '/api/accounts') return Promise.resolve({ accounts: [account] });
    if (path === '/api/approval-policies') return Promise.resolve(state.policies);
    if (path === '/api/notification/routes') return Promise.resolve({ routes: [{ groupLabel: '运营一组', chatId: 'oc_team', updatedBy: null, updatedAt: 0 }] });
    if (path === '/api/bot-chats') return Promise.resolve({ chats: [{ chatId: 'oc_team', name: '运营一组群', isDefault: true }], defaultChatId: 'oc_team', source: 'feishu' });
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn((path: string, body: any) => {
    state.putCalls.push({ path, body });
    if (path === '/api/approval-policies/account-comment') {
      return Promise.resolve({ policy: { accountId: body.accountId, mode: body.mode, configured: true, updatedBy: 'alice', updatedAt: 1 } });
    }
    if (path === '/api/approval-policies/group-publish') {
      return Promise.resolve({ policy: { groupLabel: body.groupLabel, delivery: body.delivery, configured: true, updatedBy: 'alice', updatedAt: 1 } });
    }
    return Promise.resolve({ route: null });
  }),
  apiPost: vi.fn(() => Promise.resolve({ status: 'active' })),
}));

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <AntdApp><QueryClientProvider client={client}>{node}</QueryClientProvider></AntdApp>
    </MemoryRouter>,
  );
}

describe('approval policy controls', () => {
  beforeEach(() => {
    state.putCalls = [];
    state.policies = {
      accounts: [{ accountId: 'acc-1', mode: 'source_rules', configured: false, updatedBy: null, updatedAt: null }],
      groups: [{
        groupLabel: '运营一组', delivery: 'client_only', configured: true, updatedBy: 'alice', updatedAt: 0,
        activeAccountCount: 2, reachableAccountCount: 1,
      }],
    };
  });

  it('account control states that global exemption includes manual /comment and writes server policy', async () => {
    renderPage(<AccountsPage />);
    expect(await screen.findByText('账号全局免审会覆盖所有评论来源')).toBeTruthy();
    expect(screen.getByText(/飞书手工 \/comment/)).toBeTruthy();
    await screen.findByText('小猫');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '账号 acc-1 评论审批' }));
    fireEvent.click(await screen.findByText('全局免审（含 /comment）', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(state.putCalls).toContainEqual({
      path: '/api/approval-policies/account-comment',
      body: { accountId: 'acc-1', mode: 'auto_approve_all' },
    }));
  });

  it('group client-only control shows incomplete coverage fallback and corrected routing semantics', async () => {
    renderPage(<NotificationRoutesPage />);
    expect(await screen.findByText('客户端可审批 1/2 个活跃账号')).toBeTruthy();
    expect(screen.getByText('未覆盖账号仍会回退发送飞书卡')).toBeTruthy();
    expect(screen.getByText(/飞书命令产生的卡优先回命令来源会话/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '分组 运营一组 稿件审核入口' }));
    fireEvent.click(await screen.findByText('客户端 + 飞书', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(state.putCalls).toContainEqual({
      path: '/api/approval-policies/group-publish',
      body: { groupLabel: '运营一组', delivery: 'client_and_feishu' },
    }));
  });
});
