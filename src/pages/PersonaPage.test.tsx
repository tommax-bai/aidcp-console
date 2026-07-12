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
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    if (path === '/api/persona') return Promise.resolve(state.personaCatalog);
    if (path === '/api/accounts') return Promise.resolve({ accounts: state.accounts });
    if (path.startsWith('/api/persona/')) return Promise.resolve(state.personaDetail);
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    state.personaCatalog = {
      accounts: state.personaCatalog.accounts.map((a) =>
        a.accountId === 'acc-1'
          ? { ...a, source: 'none', identityName: '', identityRole: '', updatedAt: null, updatedBy: null }
          : a,
      ),
    };
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
});
