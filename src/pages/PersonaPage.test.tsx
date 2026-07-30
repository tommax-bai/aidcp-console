import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersonaPage } from './PersonaPage';
import type { PanelAccount, PersonaConfigCatalog, PersonaDetailView } from '../types/api';

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

const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element, pseudoElt?: string | null): CSSStyleDeclaration => {
  if (pseudoElt) return { getPropertyValue: () => '0px' } as unknown as CSSStyleDeclaration;
  return realGetComputedStyle(elt);
}) as typeof window.getComputedStyle;

const state = vi.hoisted(() => ({
  getCalls: [] as string[],
  putCalls: [] as Array<{ path: string; body: unknown }>,
  personaCatalog: { accounts: [] } as PersonaConfigCatalog,
  personaDetail: null as PersonaDetailView | null,
  accounts: [] as PanelAccount[],
  environments: [] as unknown[],
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    if (path === '/api/persona') return Promise.resolve(state.personaCatalog);
    if (path === '/api/accounts') return Promise.resolve({ accounts: state.accounts });
    if (path === '/api/environments') {
      return Promise.resolve({ environments: state.environments, asOf: 1 });
    }
    if (path.startsWith('/api/persona/')) return Promise.resolve(state.personaDetail);
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    const accountId = decodeURIComponent(path.slice('/api/persona/'.length));
    const persona = (body as { persona?: unknown }).persona;
    const personaBound = typeof persona === 'string' && persona.trim().length > 0;
    state.personaCatalog = {
      accounts: state.personaCatalog.accounts.map((a) =>
        a.accountId === accountId
          ? {
              ...a,
              source: personaBound ? 'override' : 'none',
              identityName: personaBound ? a.identityName : '',
              identityRole: personaBound ? a.identityRole : '',
              updatedAt: personaBound ? a.updatedAt : null,
              updatedBy: personaBound ? a.updatedBy : null,
            }
          : a,
      ),
    };
    state.accounts = state.accounts.map((account) =>
      account.accountId === accountId
        ? { ...account, personaBound, needsPersonaSetup: !personaBound }
        : account,
    );
    return Promise.resolve(state.personaCatalog);
  }),
}));

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <PersonaPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

describe('PersonaPage', () => {
  beforeEach(() => {
    state.getCalls = [];
    state.putCalls = [];
    state.environments = [];
    state.personaCatalog = {
      accounts: [
        {
          accountId: 'acc-1',
          label: '运营名',
          source: 'override',
          identityName: '旧人设',
          identityRole: '博主',
          updatedAt: '2026-07-12T00:00:00.000Z',
          updatedBy: 'op',
        },
      ],
    };
    state.personaDetail = {
      accountId: 'acc-1',
      label: '运营名',
      source: 'override',
      persona: 'identity:\n  name: 旧人设\n',
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'op',
    };
    state.accounts = [
      {
        accountId: 'acc-1',
        label: '运营名',
        nickname: '账号昵称',
        operatorAlias: null,
        displayName: '账号昵称',
        displayNameSource: 'platform_nickname',
        platform: 'xiaohongshu',
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
      },
    ];
  });

  it('clearing the editor saves an empty persona as unbind instead of blocking locally', async () => {
    renderPage();

    const edit = await screen.findByRole('button', { name: /编\s*辑/ });
    fireEvent.click(edit);

    const dialog = await screen.findByRole('dialog');
    const textarea = await within(dialog).findByDisplayValue(/旧人设/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/persona/acc-1',
        body: { persona: '' },
      }),
    );
  });

  it('shows the rule-mode/no-persona combination without opening or guiding into the persona editor', async () => {
    state.personaCatalog = {
      accounts: [{
        accountId: 'fb-1',
        label: 'Facebook 账号',
        source: 'none',
        identityName: '',
        identityRole: '',
        updatedAt: null,
        updatedBy: null,
      }],
    };
    state.accounts = [{
      ...state.accounts[0]!,
      accountId: 'fb-1',
      label: 'Facebook 账号',
      nickname: 'Facebook 账号',
      displayName: 'Facebook 账号',
      platform: 'facebook',
      personaBound: false,
      needsPersonaSetup: true,
    }];
    state.environments = [{
      envKey: 'facebook-env-1',
      platform: 'facebook',
      lifecycle: { state: 'active' },
      account: { accountId: 'fb-1', platform: 'facebook' },
      executionBinding: { state: 'bound', accountId: 'fb-1' },
      facebookRuleMode: { envKey: 'facebook-env-1', enabled: true },
    }];

    renderPage();

    expect(await screen.findByText('按规则运行、未绑人设')).toBeTruthy();
    expect(screen.queryByText(/^未绑定$/)).toBeNull();
    expect(screen.getByText(/规则批次的浏览、点赞、加群和模板评论不读取人设/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refreshes account binding facts after unbinding and converges to the rule-mode/no-persona state', async () => {
    state.personaCatalog = {
      accounts: [{
        accountId: 'fb-1',
        label: 'Facebook 账号',
        source: 'override',
        identityName: '旧人设',
        identityRole: '运营',
        updatedAt: '2026-07-12T00:00:00.000Z',
        updatedBy: 'op',
      }],
    };
    state.personaDetail = {
      accountId: 'fb-1',
      label: 'Facebook 账号',
      source: 'override',
      persona: 'identity:\n  name: 旧人设\n',
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'op',
    };
    state.accounts = [{
      ...state.accounts[0]!,
      accountId: 'fb-1',
      label: 'Facebook 账号',
      nickname: 'Facebook 账号',
      displayName: 'Facebook 账号',
      platform: 'facebook',
      personaBound: true,
      needsPersonaSetup: false,
    }];
    state.environments = [{
      envKey: 'facebook-env-1',
      platform: 'facebook',
      lifecycle: { state: 'active' },
      account: { accountId: 'fb-1', platform: 'facebook' },
      executionBinding: { state: 'bound', accountId: 'fb-1' },
      facebookRuleMode: { envKey: 'facebook-env-1', enabled: true },
    }];

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /编\s*辑/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByDisplayValue(/旧人设/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('按规则运行、未绑人设')).toBeTruthy();
  });
});
