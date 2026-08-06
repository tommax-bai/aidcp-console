/**
 * QuotasPage 受限处置策略块回归（change restricted-policy-global-config）：
 *  1) 渲染——模式中文标签 + 恢复小时数 + 已覆盖 / 系统默认 Tag（数据→UI 忠实映射，非乐观）。
 *  2) 本地闸——小时数越界（<1 / >720 / 非整数）时「保存」禁用，回到合法值即启用。
 *  3) 写非乐观——保存成功后 PUT 携逐字对齐的枚举值 body + invalidate 重取 /api/restricted-policy。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染 / mutation 路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotasPage } from './QuotasPage';

// jsdom 无 matchMedia；antd 响应式需要最小桩。
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
  if (pseudoElt) {
    return { getPropertyValue: () => '0px' } as unknown as CSSStyleDeclaration;
  }
  return realGetComputedStyle(elt);
}) as typeof window.getComputedStyle;

const SESSION_LIMITS = {
  maxDurationMin: 30,
  budget: { likes: 5, collects: 3, follows: 2, searches: 4, comments: 2, comment_likes: 2, join_groups: 1 },
  collectSaveLikeDenom: 3,
  followFansDenom: 8,
  activeWeekMask: null,
  overridden: false,
  updatedAt: null,
  updatedBy: null,
};

const RESUME_CONFIG = {
  restRatioPct: 10,
  activeWindowStartMin: 0,
  activeWindowEndMin: 1440,
  dailyMaxSessions: 0,
  dailyMaxMinutes: 0,
  idleNudgeMs: 240_000,
  idleEndMs: 3_600_000,
  overridden: false,
  updatedAt: null,
  updatedBy: null,
};

const HOT_LEAD_CONFIG = {
  postAgeMaxHours: 48,
  velocityMin: 300,
  minLikeFloor: 500,
  overridden: false,
  updatedAt: null,
  updatedBy: null,
};

const state = vi.hoisted(() => ({
  restrictedPolicy: {} as Record<string, unknown>,
  getCalls: [] as string[],
  putCalls: [] as Array<{ path: string; body: unknown }>,
  putImpl: (() => Promise.resolve({})) as (path: string, body: unknown) => Promise<unknown>,
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    if (path === '/api/pacing') return Promise.resolve({ pacing: [] });
    if (path === '/api/quotas') return Promise.resolve({ quotas: [] });
    if (path === '/api/session-limits') return Promise.resolve(SESSION_LIMITS);
    if (path === '/api/resume-config') return Promise.resolve(RESUME_CONFIG);
    if (path === '/api/hot-lead-config') return Promise.resolve(HOT_LEAD_CONFIG);
    if (path === '/api/restricted-policy') return Promise.resolve(state.restrictedPolicy);
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    return state.putImpl(path, body);
  }),
}));

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <QuotasPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

async function rpRow(modeLabel: string): Promise<HTMLElement> {
  // 精确整文本匹配（Tag 元素文本恰为标签），避开卡片说明 Alert 的长段落；findByText 等表格真渲染出来。
  const cell = await screen.findByText(modeLabel, { exact: true });
  const tr = cell.closest('tr');
  if (!tr) throw new Error('no restricted policy row');
  return tr as HTMLElement;
}

describe('QuotasPage 受限处置策略块', () => {
  beforeEach(() => {
    state.restrictedPolicy = { mode: 'browse_only', recoveryHours: 72, overridden: false, updatedAt: null, updatedBy: null };
    state.getCalls = [];
    state.putCalls = [];
    state.putImpl = () => Promise.resolve(state.restrictedPolicy);
  });

  it('渲染模式标签 + 恢复小时数 + 系统默认/已覆盖 Tag', async () => {
    renderPage();
    const tr = await rpRow('只浏览（互动暂停）');
    expect(within(tr).getByText('72')).toBeTruthy();
    expect(within(tr).getByText('系统默认')).toBeTruthy();
  });

  it('full_pause 覆盖态渲染为醒目标签 + 已覆盖', async () => {
    state.restrictedPolicy = { mode: 'full_pause', recoveryHours: 24, overridden: true, updatedAt: '2026-08-06T00:00:00Z', updatedBy: 'op' };
    renderPage();
    const tr = await rpRow('浏览也暂停');
    expect(within(tr).getByText('24')).toBeTruthy();
    expect(within(tr).getByText('已覆盖')).toBeTruthy();
  });

  it('本地闸：小时数清空 → 保存禁用；回到合法值 → 启用（输入框自身钳 1–720）', async () => {
    renderPage();
    const tr = await rpRow('只浏览（互动暂停）');
    fireEvent.click(within(tr).getByRole('button', { name: /编\s*辑/ }));

    const dialog = await screen.findByRole('dialog');
    const okBtn = () => within(dialog).getByRole('button', { name: /保\s*存/ }) as HTMLButtonElement;
    expect(okBtn().disabled).toBe(false);

    // 越界值（如 721）被 InputNumber 自身钳回范围，够不到本地闸；本地闸真正兜的是「没填」。
    const spin = within(dialog).getByRole('spinbutton');
    fireEvent.change(spin, { target: { value: '' } });
    await waitFor(() => expect(okBtn().disabled).toBe(true));

    fireEvent.change(spin, { target: { value: '48' } });
    await waitFor(() => expect(okBtn().disabled).toBe(false));
  });

  it('写非乐观：保存 → PUT 携逐字枚举 body + invalidate 重取真态', async () => {
    renderPage();
    const tr = await rpRow('只浏览（互动暂停）');
    await waitFor(() => expect(state.getCalls.filter((p) => p === '/api/restricted-policy').length).toBe(1));

    fireEvent.click(within(tr).getByRole('button', { name: /编\s*辑/ }));
    const dialog = await screen.findByRole('dialog');

    // 切模式：AntD Select 走点击展开 + 选项点击。
    fireEvent.mouseDown(dialog.querySelector('.ant-select-selector') as Element);
    const option = await screen.findByTitle('浏览也暂停');
    fireEvent.click(option);

    const spin = within(dialog).getByRole('spinbutton');
    fireEvent.change(spin, { target: { value: '24' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/restricted-policy',
        // 枚举值与云端逐字一致：full_pause（绝不转写）。
        body: { mode: 'full_pause', recoveryHours: 24 },
      }),
    );
    await waitFor(() => expect(state.getCalls.filter((p) => p === '/api/restricted-policy').length).toBeGreaterThanOrEqual(2));
  });
});
