import { App as AntdApp } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { frozenInteractionFixtures, panelAccount } from '../test/fixtures/interactionReplyConfig';
import type { ReplyConfigScopeSummary } from '../types/interactionReplyConfig';
import { WechatChannelsReplySettings } from './WechatChannelsReplySettings';

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

describe('WechatChannelsReplySettings scope mode', () => {
  it('loads and writes the stable group scope while keeping account runtime controls out of shared editing', async () => {
    const account = { ...panelAccount(), groupLabel: '华东组' };
    const fixture = frozenInteractionFixtures(account.accountId);
    let currentVersion = 1;
    let policy = structuredClone(fixture.policy.data.policy);
    const scope: ReplyConfigScopeSummary = {
      scopeId: 'scope_east',
      platform: 'wechat_channels',
      source: { type: 'group', groupLabel: '华东组' },
      memberCount: 1,
      currentVersion,
      draftVersion: currentVersion,
      publishedVersion: null,
      updatedAt: 1784044800000,
      updatedBy: 'admin_scope',
    };
    const calls: Array<{ path: string; method: string; body: unknown }> = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (path === `/api/accounts/${account.accountId}/interaction-runtime-controls`) return json(fixture.runtime);
      if (path.startsWith(`/api/accounts/${account.accountId}/reply-preview-contexts`)) return json({
        data: { accountId: account.accountId, items: [] }, meta: { requestId: 'contexts', asOf: 1 },
      });
      if (path === '/api/interaction-reply-config-scopes/scope_east/audit') return json({
        data: { scopeId: 'scope_east', items: [], nextCursor: null }, meta: { requestId: 'audit', asOf: 1 },
      });
      if (path === '/api/interaction-reply-config-scopes/scope_east/policy' && method === 'PUT') {
        policy = structuredClone((body as { policy: typeof policy }).policy);
        currentVersion += 1;
        return json({ data: { head: { ...scope, currentVersion, draftVersion: currentVersion }, snapshot: {} }, meta: { requestId: 'write', asOf: 2 } });
      }
      if (path === '/api/interaction-reply-config-scopes/scope_east' && method === 'GET') return json({
        data: {
          head: { ...scope, currentVersion, draftVersion: currentVersion },
          snapshot: {
            accountId: '', configScopeId: 'scope_east', configSource: scope.source,
            platform: 'wechat_channels', configVersion: currentVersion, state: 'draft',
            policy, templates: fixture.templates.data.items, rules: fixture.rules.data.items,
            profiles: fixture.profiles.data.profiles, createdAt: 1, createdBy: 'admin_scope',
            publishedAt: null, publishedBy: null,
          },
        },
        meta: { requestId: 'scope', asOf: 1 },
      });
      throw new Error(`unexpected request ${method} ${path}`);
    }));

    render(
      <AntdApp>
        <WechatChannelsReplySettings account={null} scope={scope} previewAccount={account} open onClose={() => undefined} />
      </AntdApp>,
    );

    expect(await screen.findByText('回复处理策略草稿')).toBeTruthy();
    expect(screen.getByText('账号运行开关仍按账号独立控制')).toBeTruthy();
    expect(screen.queryByText('即时运行控制（紧急停写）')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /不自动处理，仅收取互动/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.path ===
      '/api/interaction-reply-config-scopes/scope_east/policy')).toBe(true));
    expect(calls.some((call) => call.path.includes(`/api/accounts/${account.accountId}/interaction-reply-policy`))).toBe(false);
    await waitFor(() => expect(screen.getByText('当前聚合版本').parentElement?.textContent).toContain('v2'));
  });
});
