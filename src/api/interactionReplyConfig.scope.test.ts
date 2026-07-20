import { afterEach, describe, expect, it, vi } from 'vitest';
import { frozenInteractionFixtures } from '../test/fixtures/interactionReplyConfig';
import {
  ensureReplyConfigScope,
  listReplyConfigScopes,
  loadEffectiveReplyConfig,
  loadScopeReplyConfig,
  publishScopeReplyConfig,
  saveScopeReplyPolicy,
} from './interactionReplyConfig';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const source = { type: 'group' as const, groupLabel: '华东组' };
const head = {
  scopeId: 'scope_east',
  platform: 'wechat_channels' as const,
  source,
  memberCount: 3,
  currentVersion: 4,
  draftVersion: 4,
  publishedVersion: 3,
  updatedAt: 1784044800000,
  updatedBy: 'admin_scope',
};

afterEach(() => vi.restoreAllMocks());

describe('group-scoped reply config API', () => {
  it('maps an immutable scope snapshot into the existing editor without inventing active runtime controls', async () => {
    const fixture = frozenInteractionFixtures('acct_wc_demo');
    const fetchMock = vi.fn(async () => json({
      data: {
        head,
        snapshot: {
          accountId: '',
          configScopeId: head.scopeId,
          configSource: source,
          platform: 'wechat_channels',
          configVersion: 4,
          state: 'draft',
          policy: fixture.policy.data.policy,
          templates: fixture.templates.data.items,
          rules: fixture.rules.data.items,
          profiles: fixture.profiles.data.profiles,
          createdAt: 1784044800000,
          createdBy: 'admin_scope',
          publishedAt: null,
          publishedBy: null,
        },
      },
      meta: { requestId: 'scope-read', asOf: 1784044800000 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await loadScopeReplyConfig(head.scopeId);

    expect(fetchMock).toHaveBeenCalledWith('/api/interaction-reply-config-scopes/scope_east', expect.objectContaining({ signal: undefined }));
    expect(snapshot.head).toMatchObject({ accountId: head.scopeId, currentVersion: 4, publishedVersion: 3 });
    expect(snapshot.runtime).toMatchObject({ accountId: '', version: 0, writePaused: true });
    expect(snapshot.policy).toEqual(fixture.policy.data.policy);
  });

  it('uses only v2 scope endpoints for scope creation, mutation and publication', async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (method === 'GET') return json({ data: { items: [head] }, meta: { requestId: 'list', asOf: 1 } });
      if (path.endsWith('/publish')) return json({
        data: { head: { ...head, publishedVersion: 4 }, publishedAt: 2, publishedBy: 'admin_scope', memberCount: 3 },
        meta: { requestId: 'publish', asOf: 2 },
      });
      return json({ data: { head }, meta: { requestId: 'write', asOf: 1 } });
    }));

    await listReplyConfigScopes();
    await ensureReplyConfigScope(source);
    await saveScopeReplyPolicy(head.scopeId, {
      expectedVersion: 4,
      policy: frozenInteractionFixtures('acct_wc_demo').policy.data.policy,
    });
    const published = await publishScopeReplyConfig(head.scopeId, { expectedVersion: 4 });

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ['GET', '/api/interaction-reply-config-scopes'],
      ['POST', '/api/interaction-reply-config-scopes'],
      ['PUT', '/api/interaction-reply-config-scopes/scope_east/policy'],
      ['POST', '/api/interaction-reply-config-scopes/scope_east/publish'],
    ]);
    expect(calls[1]?.body).toEqual(source);
    expect(calls[2]?.body).toMatchObject({ expectedVersion: 4 });
    expect(published.data.head.accountId).toBe(head.scopeId);
  });

  it('reads the effective strategy source for an account from the dedicated resolver endpoint', async () => {
    const fetchMock = vi.fn(async () => json({
      data: {
        accountId: 'acct_wc_demo',
        mode: 'scoped',
        status: 'missing',
        reason: 'group_config_missing',
        source,
        currentVersion: null,
        draftVersion: null,
        publishedVersion: null,
      },
      meta: { requestId: 'effective', asOf: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await loadEffectiveReplyConfig('acct_wc_demo');

    expect(fetchMock).toHaveBeenCalledWith('/api/accounts/acct_wc_demo/effective-reply-config', expect.any(Object));
    expect(response.data).toMatchObject({ reason: 'group_config_missing', source });
  });
});
