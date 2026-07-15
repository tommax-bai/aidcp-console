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
  const calls: Array<{ path: string; method: string; body: unknown; signal?: AbortSignal | null }> = [];
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
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path, method, body, signal: init.signal });

    if (path === '/api/accounts') {
      return json({ accounts: [panelAccount(), panelAccount('fb_demo', 'facebook'), panelAccount('xhs_demo', 'xiaohongshu')] });
    }

    const match = path.match(/^\/api\/accounts\/([^/]+)\/(.+)$/);
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
    if (method === 'GET') {
      if (endpoint === 'interaction-runtime-controls') return json(store.runtime);
      if (endpoint === 'interaction-reply-policy') return json(store.policy);
      if (endpoint === 'reply-templates') return json(store.templates);
      if (endpoint === 'reply-rules') return json(store.rules);
      if (endpoint === 'reply-profile') return json(store.profiles);
      if (endpoint === 'reply-config/audit') {
        return options.auditDenied ? interactionError('INTERACTION_PERMISSION_DENIED', 403) : json(store.audit);
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
  await screen.findByText('回复策略草稿');
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
    fireEvent.click(screen.getByRole('switch', { name: '生成草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    await waitFor(() => expect(server.calls.some((call) => call.path.endsWith('/interaction-reply-policy') && call.method === 'PUT')).toBe(true));
    const call = server.calls.find((item) => item.path.endsWith('/interaction-reply-policy') && item.method === 'PUT');
    expect(call?.body).toMatchObject({ expectedVersion: 1, policy: { generateDrafts: false } });
    await waitFor(() => expect(screen.getByText('当前聚合版本').parentElement?.textContent).toContain('v2'));
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
    fireEvent.click(screen.getByRole('switch', { name: '生成草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    expect(await screen.findByText('版本冲突：远端当前为 v7')).toBeTruthy();
    expect(screen.getByText(/本次保存\/发布没有显示成功/)).toBeTruthy();
  });

  it('keeps a state conflict distinct from a version conflict', async () => {
    createServer({ stateConflictOnPolicy: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('switch', { name: '生成草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略草稿' }));
    expect(await screen.findByText('当前状态不允许该操作，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText(/版本冲突：远端当前/)).toBeNull();
  });

  it('renders view permission denied without falling back to fake defaults', async () => {
    createServer({ viewDenied: true });
    renderDrawer();
    expect(await screen.findByText('无配置查看权限')).toBeTruthy();
    expect(screen.queryByText('回复策略草稿')).toBeNull();
  });

  it('keeps view access but fail-closes draft edits without interaction.config.edit', async () => {
    const server = createServer({ editDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('switch', { name: '生成草稿' }));
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
    expect(await screen.findByText('缺少 interaction.config.preview 权限，未运行预览。')).toBeTruthy();
    expect(screen.queryByText('Cloud 预览结果')).toBeNull();
  });

  it('scopes a denied DM preview so comment preview can still be attempted', async () => {
    createServer({ previewDenied: true });
    renderDrawer();
    await waitForConfig();
    fireEvent.click(screen.getByRole('tab', { name: '模拟预览' }));
    fireEvent.click(screen.getByRole('radio', { name: '私信' }));
    fireEvent.click(screen.getByRole('button', { name: '运行无副作用预览' }));
    expect(await screen.findByText('缺少 interaction.config.preview 或 interaction.dm.view_full 权限，未运行私信预览。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '运行无副作用预览' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: '评论' }));
    expect((screen.getByRole('button', { name: '运行无副作用预览' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/未运行私信预览/)).toBeNull();
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
