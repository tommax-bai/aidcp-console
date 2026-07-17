import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from '../pages/AccountsPage';
import { frozenInteractionFixtures, panelAccount } from '../test/fixtures/interactionReplyConfig';
import type { PreviewAction } from '../types/interactionReplyConfig';
import { WechatChannelsReplySettings } from './WechatChannelsReplySettings';

interface ServerOptions {
  viewDenied?: boolean;
  editDenied?: boolean;
  publishDenied?: boolean;
  previewDenied?: boolean;
  auditDenied?: boolean;
  conflictOnPolicy?: boolean;
  stateConflictOnPolicy?: boolean;
  previewAction?: PreviewAction;
  slowAccountId?: string;
  missingConfig?: boolean;
  initializeDenied?: boolean;
  initializeConflict?: boolean;
  auditPagination?: boolean;
  auditPageFailures?: number;
  slowAuditPageAccountId?: string;
  unknownAuditEnums?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function interactionError(code: string, status: number, details?: unknown): Response {
  return json({
    error: {
      code,
      message: code,
      requestId: `error-${status}`,
      retryable: false,
      ...(details ? { details } : {}),
    },
  }, status);
}

function createServer(options: ServerOptions = {}) {
  const stores = new Map<string, ReturnType<typeof frozenInteractionFixtures>>();
  const initializedAccounts = new Set<string>();
  const calls: Array<{ path: string; method: string; body: unknown; signal?: AbortSignal | null }> = [];
  let remainingAuditPageFailures = options.auditPageFailures ?? 0;
  const getStore = (accountId: string) => {
    let store = stores.get(accountId);
    if (!store) {
      store = frozenInteractionFixtures(accountId);
      stores.set(accountId, store);
    }
    return store;
  };
  const bumpVersion = (store: ReturnType<typeof frozenInteractionFixtures>) => {
    const next = store.policy.data.head.currentVersion + 1;
    store.policy.data.head.currentVersion = next;
    store.policy.data.head.draftVersion = next;
    store.policy.data.head.updatedAt += 1000;
    store.templates.data.currentVersion = next;
    store.rules.data.currentVersion = next;
    store.profiles.data.currentVersion = next;
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === 'string' ? input : input.toString();
    const requestUrl = new URL(path, 'http://console.test');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path, method, body, signal: init.signal });

    if (requestUrl.pathname === '/api/accounts') {
      return json({ accounts: [panelAccount(), panelAccount('fb_demo', 'facebook'), panelAccount('xhs_demo', 'xiaohongshu')] });
    }

    const match = requestUrl.pathname.match(/^\/api\/accounts\/([^/]+)\/(.+)$/);
    if (!match) return interactionError('INTERACTION_NOT_FOUND', 404);
    const accountId = decodeURIComponent(match[1]);
    const endpoint = match[2];
    const store = getStore(accountId);

    if (accountId === options.slowAccountId && method === 'GET') {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }

    if (options.viewDenied && method === 'GET' && endpoint !== 'reply-config/audit') {
      return interactionError('INTERACTION_PERMISSION_DENIED', 403);
    }
    if (options.missingConfig && !initializedAccounts.has(accountId) && method === 'GET'
      && endpoint !== 'interaction-runtime-controls' && endpoint !== 'reply-config/audit') {
      return interactionError('INTERACTION_CONFIG_MISSING', 404);
    }
    if (method === 'GET') {
      if (endpoint === 'interaction-runtime-controls') return json(store.runtime);
      if (endpoint === 'interaction-reply-policy') return json(store.policy);
      if (endpoint === 'reply-templates') return json(store.templates);
      if (endpoint === 'reply-rules') return json(store.rules);
      if (endpoint === 'reply-profile') return json(store.profiles);
      if (endpoint === 'reply-config/audit') {
        if (options.auditDenied) return interactionError('INTERACTION_PERMISSION_DENIED', 403);
        const cursor = requestUrl.searchParams.get('cursor');
        if (cursor) {
          if (accountId === options.slowAuditPageAccountId) {
            return await new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
          }
          if (remainingAuditPageFailures > 0) {
            remainingAuditPageFailures -= 1;
            return interactionError('INTERACTION_UPSTREAM_UNAVAILABLE', 503);
          }
          const page = structuredClone(store.audit);
          page.data.items = [
            structuredClone(store.audit.data.items[0]),
            {
              eventId: `audit_page_002_${accountId}`,
              actor: `admin_${accountId}`,
              action: 'config_published',
              configVersion: 1,
              entityType: 'config',
              entityId: accountId,
              summary: `第二页审计 · ${accountId}`,
              createdAt: 1784044700000,
            },
          ];
          page.data.nextCursor = null;
          return json(page);
        }
        const firstPage = structuredClone(store.audit);
        if (options.auditPagination) firstPage.data.nextCursor = 'opaque/+==';
        if (options.unknownAuditEnums) {
          firstPage.data.items.unshift({
            eventId: `audit_future_${accountId}`,
            actor: 'admin_future',
            action: 'policy_reconciled',
            configVersion: 2,
            entityType: 'runtime_control',
            entityId: accountId,
            summary: '未来审计枚举仍须可读。',
            createdAt: 1784044800000,
          });
        }
        return json(firstPage);
      }
    }

    if (endpoint === 'reply-preview' && method === 'POST') {
      if (options.previewDenied) return interactionError('INTERACTION_PERMISSION_DENIED', 403);
      const preview = structuredClone(store.preview);
      if (options.previewAction === 'no_match') {
        preview.data.matchedRule = null;
        preview.data.template = null;
        preview.data.polish = null;
        preview.data.action = 'no_match';
      } else if (options.previewAction === 'blocked') {
        preview.data.risk = { level: 'high', tags: ['refund'], reasons: ['涉及退款，平台强制人工。'] };
        preview.data.action = 'blocked';
      } else if (options.previewAction) {
        preview.data.action = options.previewAction;
      }
      return json(preview);
    }

    if (endpoint === 'reply-config/initialize' && method === 'POST') {
      if (options.initializeDenied) return interactionError('INTERACTION_PERMISSION_DENIED', 403);
      initializedAccounts.add(accountId);
      if (options.initializeConflict) {
        return interactionError('INTERACTION_VERSION_CONFLICT', 409, { currentVersion: 1 });
      }
      store.audit.data.items.unshift({
        eventId: 'audit_initialize_001',
        actor: 'admin_initialize',
        action: 'config_initialized',
        configVersion: 1,
        entityType: 'config',
        entityId: null,
        summary: '创建安全默认草稿。',
        createdAt: 1784044850000,
      });
      return json({
        data: { head: store.policy.data.head, initializedVersion: 1 },
        meta: { requestId: 'initialize-001', asOf: 1784044850000 },
      });
    }

    if (endpoint === 'reply-config/publish' && method === 'POST') {
      if (options.publishDenied) return interactionError('INTERACTION_PERMISSION_DENIED', 403);
      store.policy.data.head.publishedVersion = store.policy.data.head.currentVersion;
      store.audit.data.items.unshift({
        eventId: 'audit_publish_001',
        actor: 'admin_publish',
        action: 'config_published',
        configVersion: store.policy.data.head.currentVersion,
        entityType: 'config',
        entityId: null,
        summary: '发布账号级回复配置。',
        createdAt: 1784044900000,
      });
      return json({
        data: {
          head: store.policy.data.head,
          publishedAt: 1784044900000,
          publishedBy: 'admin_publish',
        },
        meta: { requestId: 'publish-001', asOf: 1784044900000 },
      });
    }

    if (options.editDenied) return interactionError('INTERACTION_PERMISSION_DENIED', 403);

    if (endpoint === 'interaction-runtime-controls' && method === 'PUT') {
      const update = body as Record<string, boolean | number>;
      store.runtime.data = {
        ...store.runtime.data,
        commentsReadEnabled: Boolean(update.commentsReadEnabled),
        commentsReplyEnabled: Boolean(update.commentsReplyEnabled),
        dmReadEnabled: Boolean(update.dmReadEnabled),
        dmSendTextEnabled: Boolean(update.dmSendTextEnabled),
        dmSendImageEnabled: false,
        writePaused: Boolean(update.writePaused),
        version: store.runtime.data.version + 1,
      };
      return json({ data: store.runtime.data, meta: store.runtime.meta });
    }
    if (endpoint === 'interaction-reply-policy' && method === 'PUT') {
      if (options.conflictOnPolicy) {
        return interactionError('INTERACTION_VERSION_CONFLICT', 409, { currentVersion: 7 });
      }
      if (options.stateConflictOnPolicy) {
        return interactionError('INTERACTION_STATE_CONFLICT', 409);
      }
      store.policy.data.policy = structuredClone((body as { policy: typeof store.policy.data.policy }).policy);
      bumpVersion(store);
      return json(store.policy);
    }
    if (endpoint === 'reply-profile' && method === 'PUT') {
      store.profiles.data.profiles = structuredClone((body as { profiles: typeof store.profiles.data.profiles }).profiles);
      bumpVersion(store);
      return json(store.profiles);
    }
    if (endpoint === 'reply-templates' && method === 'POST') {
      store.templates.data.items.push(structuredClone((body as { template: typeof store.templates.data.items[number] }).template));
      bumpVersion(store);
      return json(store.templates);
    }
    if (endpoint.startsWith('reply-templates/') && method === 'PUT') {
      const template = structuredClone((body as { template: typeof store.templates.data.items[number] }).template);
      const index = store.templates.data.items.findIndex((item) => item.templateId === template.templateId);
      store.templates.data.items[index] = template;
      bumpVersion(store);
      return json(store.templates);
    }
    if (endpoint.startsWith('reply-templates/') && method === 'DELETE') {
      const id = decodeURIComponent(endpoint.split('/')[1]);
      const item = store.templates.data.items.find((template) => template.templateId === id);
      if (item) item.archived = true;
      bumpVersion(store);
      return json(store.templates);
    }
    if (endpoint === 'reply-rules' && method === 'POST') {
      store.rules.data.items.push(structuredClone((body as { rule: typeof store.rules.data.items[number] }).rule));
      bumpVersion(store);
      return json(store.rules);
    }
    if (endpoint.startsWith('reply-rules/') && method === 'PUT') {
      const rule = structuredClone((body as { rule: typeof store.rules.data.items[number] }).rule);
      const index = store.rules.data.items.findIndex((item) => item.ruleId === rule.ruleId);
      store.rules.data.items[index] = rule;
      bumpVersion(store);
      return json(store.rules);
    }
    if (endpoint.startsWith('reply-rules/') && method === 'DELETE') {
      const id = decodeURIComponent(endpoint.split('/')[1]);
      store.rules.data.items = store.rules.data.items.filter((rule) => rule.ruleId !== id);
      bumpVersion(store);
      return json(store.rules);
    }
    return interactionError('INTERACTION_NOT_FOUND', 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, stores };
}

function renderDrawer(account = panelAccount()) {
  return render(
    <AntdApp>
      <WechatChannelsReplySettings account={account} open onClose={() => undefined} />
    </AntdApp>,
  );
}

async function waitForConfig() {
  await screen.findByText('回复处理策略草稿');
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

describe('WechatChannelsReplySettings', () => {
  it('only shows the account-level reply entry for wechat_channels accounts', async () => {
    createServer();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AccountsPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>,
    );
    expect(await screen.findAllByRole('button', { name: '回复设置' })).toHaveLength(1);
    expect(screen.getByText('视频号')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'FB配置' })).toHaveLength(1);
  });

  it('loads frozen v1 slices and saves policy draft with aggregate expectedVersion', async () => {
    const server = createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('radio', { name: /不自动处理，仅收取互动/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.endsWith('/interaction-reply-policy') && call.method === 'PUT')).toBe(true));
    const call = server.calls.find((item) => item.path.endsWith('/interaction-reply-policy') && item.method === 'PUT');
    expect(call?.body).toMatchObject({
      expectedVersion: 1,
      policy: { mode: 'draft_only', generateDrafts: false, sendReplies: false },
    });
    await waitFor(() => expect(screen.getByText('当前聚合版本').parentElement?.textContent).toContain('v2'));
  });

  it('shows one fail-closed processing choice and asks for channel auto scope only in auto mode', async () => {
    createServer();
    renderDrawer();
    await waitForConfig();

    expect((screen.getByRole('radio', { name: /只生成回复草稿/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/检测到历史组合，已按不扩权原则显示为/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: '生成草稿' })).toBeNull();
    expect(screen.queryByText('配置层发送开关；不能绕过即时写总闸。')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '此渠道的低风险模板可自动发送' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /低风险模板自动发送/ }));
    expect(screen.getAllByRole('checkbox', { name: '此渠道的低风险模板可自动发送' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: /人工审核后发送/ }));
    expect(screen.queryByRole('checkbox', { name: '此渠道的低风险模板可自动发送' })).toBeNull();
  });

  it('publishes only through reply-config/publish and displays the returned published version', async () => {
    const server = createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    const publishTitle = await screen.findByText('发布回复配置');
    const dialog = publishTitle.closest('.ant-modal') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.endsWith('/reply-config/publish') && call.method === 'POST')).toBe(true));
    expect(server.calls.some((call) => call.path.includes('/send'))).toBe(false);
    await screen.findByText('published v1');
  });

  it('summarizes the effective processing intent without repeating wire-level switches', async () => {
    createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    const publishTitle = await screen.findByText('发布回复配置');
    const dialog = publishTitle.closest('.ant-modal') as HTMLElement;
    expect(within(dialog).getByText('回复处理方式：只生成回复草稿')).toBeTruthy();
    expect(within(dialog).queryByText(/配置发送开关/)).toBeNull();
    expect(within(dialog).queryByText(/运行模式：/)).toBeNull();
  });

  it('does not change published state when interaction.config.publish is denied', async () => {
    const server = createServer({ publishDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    const publishTitle = await screen.findByText('发布回复配置');
    const dialog = publishTitle.closest('.ant-modal') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('当前账号缺少 interaction.config.publish 权限，发布未执行。')).toBeTruthy();
    expect(server.stores.get('acct_wc_demo')?.policy.data.head.publishedVersion).toBeNull();
  });

  it('shows version conflict and never presents a false save success', async () => {
    createServer({ conflictOnPolicy: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('radio', { name: /不自动处理，仅收取互动/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    expect(await screen.findByText('版本冲突：远端当前为 v7')).toBeTruthy();
    expect(screen.getByText(/本次保存\/发布没有显示成功/)).toBeTruthy();
  });

  it('keeps a state conflict distinct from a version conflict', async () => {
    createServer({ stateConflictOnPolicy: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('radio', { name: /不自动处理，仅收取互动/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    expect(await screen.findByText('当前状态不允许该操作，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText(/版本冲突：远端当前/)).toBeNull();
  });

  it('renders view permission denied without falling back to fake defaults', async () => {
    createServer({ viewDenied: true });
    renderDrawer();
    expect(await screen.findByText('无配置查看权限')).toBeTruthy();
    expect(screen.queryByText('回复处理策略草稿')).toBeNull();
  });

  it('shows missing config explicitly and initializes only a safe unpublished draft', async () => {
    const server = createServer({ missingConfig: true });
    renderDrawer();
    expect(await screen.findByText('尚未创建互动回复配置')).toBeTruthy();
    expect(screen.queryByText('回复处理策略草稿')).toBeNull();
    expect(screen.getByText(/不会发布配置，不会创建模板或规则，也不会开启回复、自动发送或即时账号写入/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '创建安全草稿' }));
    await waitForConfig();
    const initializeCall = server.calls.find((call) => call.path.endsWith('/reply-config/initialize') && call.method === 'POST');
    expect(initializeCall?.body).toEqual({ expectedVersion: 0 });
    expect(screen.getByText('draft v1')).toBeTruthy();
    expect(screen.getByText('published v未发布')).toBeTruthy();
    expect(server.calls.some((call) => call.path.endsWith('/reply-config/publish'))).toBe(false);
    expect(server.calls.some((call) => call.path.includes('/send'))).toBe(false);
  });

  it('keeps missing config unchanged when initialize permission is denied', async () => {
    const server = createServer({ missingConfig: true, initializeDenied: true });
    renderDrawer();
    await screen.findByText('尚未创建互动回复配置');
    fireEvent.click(screen.getByRole('button', { name: '创建安全草稿' }));
    expect(await screen.findByText('缺少 interaction.config.edit 权限，未创建任何配置。')).toBeTruthy();
    expect(screen.queryByText('回复处理策略草稿')).toBeNull();
    expect(server.calls.filter((call) => call.path.endsWith('/reply-config/initialize'))).toHaveLength(1);
  });

  it('recovers by reading truth when another admin initializes concurrently', async () => {
    const server = createServer({ missingConfig: true, initializeConflict: true });
    renderDrawer();
    await screen.findByText('尚未创建互动回复配置');
    fireEvent.click(screen.getByRole('button', { name: '创建安全草稿' }));
    await waitForConfig();
    expect(screen.getByText('draft v1')).toBeTruthy();
    expect(server.calls.filter((call) => call.path.endsWith('/reply-config/initialize'))).toHaveLength(1);
    expect(server.calls.filter((call) => call.path.endsWith('/interaction-reply-policy') && call.method === 'GET').length).toBeGreaterThan(1);
  });

  it('keeps view access but fail-closes draft edits without interaction.config.edit', async () => {
    const server = createServer({ editDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('radio', { name: /不自动处理，仅收取互动/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    expect(await screen.findByText('当前账号缺少 interaction.config.edit 权限，草稿未保存。')).toBeTruthy();
    expect(server.stores.get('acct_wc_demo')?.policy.data.policy.generateDrafts).toBe(true);
  });

  it('shows audit permission denied independently from the editable configuration', async () => {
    createServer({ auditDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '审计' }));
    expect(await screen.findByText('无审计查看权限')).toBeTruthy();
    expect(screen.getByText(/需要 interaction.audit.view/)).toBeTruthy();
  });

  it('appends an opaque-cursor audit page, deduplicates event ids, and shows the honest end state', async () => {
    const server = createServer({ auditPagination: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '审计' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多审计记录' }));
    expect(await screen.findByText('第二页审计 · acct_wc_demo')).toBeTruthy();
    expect(screen.getByText('已加载全部审计记录')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加载更多审计记录' })).toBeNull();
    expect(screen.getAllByText('保存草稿')).toHaveLength(1);
    expect(server.calls.some((call) => call.path.includes('cursor=opaque%2F%2B%3D%3D'))).toBe(true);
  });

  it('keeps loaded audit rows on a page error and retries the same cursor', async () => {
    const server = createServer({ auditPagination: true, auditPageFailures: 1 });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '审计' }));
    expect(await screen.findByText('保存账号级回复策略草稿。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载更多审计记录' }));
    expect(await screen.findByText('后续审计加载失败')).toBeTruthy();
    expect(screen.getByText('保存账号级回复策略草稿。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试加载更多' }));
    expect(await screen.findByText('第二页审计 · acct_wc_demo')).toBeTruthy();
    expect(server.calls.filter((call) => call.path.includes('cursor=opaque%2F%2B%3D%3D'))).toHaveLength(2);
  });

  it('renders unknown audit action and entity wire values without hiding the event', async () => {
    createServer({ unknownAuditEnums: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '审计' }));
    expect(await screen.findByText('policy_reconciled')).toBeTruthy();
    expect(screen.getByText(/runtime_control/)).toBeTruthy();
    expect(screen.getByText('未来审计枚举仍须可读。')).toBeTruthy();
  });

  it('aborts an in-flight audit page when switching accounts and never appends it to the new account', async () => {
    const server = createServer({ auditPagination: true, slowAuditPageAccountId: 'acct_slow_audit' });
    const slow = { ...panelAccount('acct_slow_audit'), nickname: '慢审计账号' };
    const fast = { ...panelAccount('acct_fast_audit'), nickname: '新审计账号' };
    const view = render(
      <AntdApp>
        <WechatChannelsReplySettings account={slow} open onClose={() => undefined} />
      </AntdApp>,
    );
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '审计' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多审计记录' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.includes('/acct_slow_audit/') && call.path.includes('cursor='))).toBe(true));

    view.rerender(
      <AntdApp>
        <WechatChannelsReplySettings account={fast} open onClose={() => undefined} />
      </AntdApp>,
    );
    await screen.findByText('互动回复设置 · 新审计账号');
    await waitForConfig();
    const slowPage = server.calls.find((call) => call.path.includes('/acct_slow_audit/') && call.path.includes('cursor='));
    expect(slowPage?.signal?.aborted).toBe(true);
    expect(screen.queryByText('第二页审计 · acct_slow_audit')).toBeNull();
  });

  it('keeps platform hard gates disabled and exposes accessible preview labels', async () => {
    createServer();
    renderDrawer();
    await waitForConfig();
    expect((screen.getByRole('switch', { name: '私信图片发送固定关闭' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '风险门禁' }));
    expect(screen.getAllByText('平台强制')).toHaveLength(6);

    fireEvent.click(screen.getByRole('tab', { name: '模拟预览' }));
    expect(screen.getByRole('textbox', { name: '模拟用户昵称' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '模拟视频标题' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '模拟互动内容' })).toBeTruthy();
  });

  it('flags unknown template variables immediately and blocks the create request', async () => {
    const server = createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: /回复模板/ }));
    const editButton = await screen.findByText('编辑草稿');
    fireEvent.click(editButton.closest('button') as HTMLButtonElement);
    const editorTitle = await screen.findByText('编辑模板草稿');
    const dialog = editorTitle.closest('.ant-modal') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText('模板正文'), { target: { value: '您好 {{order_total}}' } });
    expect(await within(dialog).findByText('未知变量：{{order_total}}')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(within(dialog).getByText(/请先移除未知变量/)).toBeTruthy());
    expect(server.calls.some((call) => call.path.includes('/reply-templates/') && call.method === 'PUT')).toBe(false);
  });

  it('creates a template with the exact frozen write shape and derived variable whitelist', async () => {
    const server = createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: /回复模板/ }));
    fireEvent.click(await screen.findByRole('button', { name: '新建模板' }));
    const editorTitle = await screen.findByText('新建回复模板');
    const dialog = editorTitle.closest('.ant-modal') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText('模板名称'), { target: { value: '评论补充说明' } });
    fireEvent.change(within(dialog).getByLabelText('模板正文'), { target: { value: '你好 {{user_name}}，请查看 {{video_title}}。' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.endsWith('/reply-templates') && call.method === 'POST')).toBe(true));
    const call = server.calls.find((item) => item.path.endsWith('/reply-templates') && item.method === 'POST');
    expect(call?.body).toMatchObject({
      expectedVersion: 1,
      template: {
        channel: 'comment',
        name: '评论补充说明',
        variables: ['user_name', 'video_title'],
        templateVersion: 1,
      },
    });
  });

  it('presents rule automation as a restriction and forces AI-polished rules to human review', async () => {
    const server = createServer();
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: /匹配规则/ }));
    const ruleName = await screen.findByText(/感谢类评论/);
    const ruleRow = ruleName.closest('tr') as HTMLElement;
    fireEvent.click(within(ruleRow).getByText('编辑').closest('button') as HTMLButtonElement);

    const editorTitle = await screen.findByText('编辑匹配规则');
    const dialog = editorTitle.closest('.ant-modal') as HTMLElement;
    const polish = within(dialog).getByRole('checkbox', { name: '使用 AI 润色（必须人工审核）' }) as HTMLInputElement;
    const mustReview = within(dialog).getByRole('checkbox', { name: '此规则必须人工审核' }) as HTMLInputElement;
    expect(polish.checked).toBe(true);
    expect(mustReview.checked).toBe(true);
    expect(mustReview.disabled).toBe(true);

    fireEvent.click(polish);
    expect(mustReview.disabled).toBe(false);
    fireEvent.click(mustReview);
    expect(mustReview.checked).toBe(false);
    fireEvent.click(polish);
    expect(mustReview.checked).toBe(true);
    expect(mustReview.disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.includes('/reply-rules/') && call.method === 'PUT')).toBe(true));
    const call = server.calls.find((item) => item.path.includes('/reply-rules/') && item.method === 'PUT');
    expect(call?.body).toMatchObject({ rule: { actions: { polish: true, allowAutoSend: false } } });
  });

  it.each([
    ['review_required', '需要人工审核'],
    ['no_match', '没有命中规则'],
    ['blocked', '被风险门禁阻断'],
  ] as const)('renders preview state %s and never calls a send endpoint', async (previewAction, expectedLabel) => {
    const server = createServer({ previewAction });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '模拟预览' }));
    fireEvent.change(await screen.findByLabelText('模拟互动内容'), { target: { value: '测试互动' } });
    fireEvent.click(screen.getByRole('button', { name: /运行无副作用预览/ }));
    expect(await screen.findByText(expectedLabel)).toBeTruthy();
    expect(server.calls.some((call) => call.path.endsWith('/reply-preview') && call.method === 'POST')).toBe(true);
    expect(server.calls.some((call) => call.path.includes('/send'))).toBe(false);
    fireEvent.change(screen.getByLabelText('模拟互动内容'), { target: { value: '修改后的模拟内容' } });
    expect(screen.queryByText(expectedLabel)).toBeNull();
  });

  it('fail-closes preview permission without inventing a result', async () => {
    createServer({ previewDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '模拟预览' }));
    fireEvent.click(screen.getByRole('button', { name: '运行无副作用预览' }));
    expect(await screen.findByText('当前后台账号没有模拟预览权限（interaction.config.preview），Cloud 预览链路未运行。')).toBeTruthy();
    expect(screen.queryByText('Cloud 预览结果')).toBeNull();
  });

  it('scopes a denied DM preview so comment preview can still be attempted', async () => {
    createServer({ previewDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '模拟预览' }));
    fireEvent.click(screen.getByRole('radio', { name: '私信' }));
    fireEvent.click(screen.getByRole('button', { name: '运行无副作用预览' }));
    expect(await screen.findByText('当前后台账号缺少私信预览权限（interaction.config.preview 与 interaction.dm.view_full），Cloud 预览链路未运行。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '运行无副作用预览' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: '评论' }));
    expect((screen.getByRole('button', { name: '运行无副作用预览' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/缺少私信预览权限/)).toBeNull();
  });

  it('aborts the previous account reads and prevents stale account content from winning', async () => {
    const server = createServer({ slowAccountId: 'acct_slow' });
    const slow = { ...panelAccount('acct_slow'), nickname: '慢账号' };
    const fast = { ...panelAccount('acct_fast'), nickname: '新账号' };
    const view = render(
      <AntdApp>
        <WechatChannelsReplySettings account={slow} open onClose={() => undefined} />
      </AntdApp>,
    );
    await waitFor(() => expect(server.calls.some((call) => call.path.includes('/acct_slow/'))).toBe(true));
    view.rerender(
      <AntdApp>
        <WechatChannelsReplySettings account={fast} open onClose={() => undefined} />
      </AntdApp>,
    );
    await screen.findByText('互动回复设置 · 新账号');
    await waitForConfig();
    const slowSignals = server.calls.filter((call) => call.path.includes('/acct_slow/')).map((call) => call.signal);
    expect(slowSignals.length).toBeGreaterThan(0);
    expect(slowSignals.every((signal) => signal?.aborted)).toBe(true);
    expect(screen.queryByText('互动回复设置 · 慢账号')).toBeNull();
  });
});
