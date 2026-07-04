/**
 * QuotasPage 节奏兜底块回归（change pacing-floor-config-min-interval）：
 *  1) 渲染——每 op 生效 min/max 值 + 已覆盖 / 系统默认 Tag（数据→UI 忠实映射，非乐观）。
 *  2) 本地 canSave 双闸——最大 < 最小×1.5（展宽不足）时「保存」禁用，回到合法值即启用。
 *  3) 写非乐观——保存成功后 invalidate 触发 /api/pacing 重取真态（而非乐观改缓存）。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染 / mutation 路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotasPage } from './QuotasPage';
import type { PacingConfigRow } from '../types/api';

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

const PACING_ROWS: PacingConfigRow[] = [
  { operation: 'action', minMs: 1500, maxMs: 4000, overridden: true, updatedAt: '2026-07-04T00:00:00Z', updatedBy: 'op' },
  { operation: 'feed_card_read', minMs: 450, maxMs: 7000, overridden: false, updatedAt: null, updatedBy: null },
  { operation: 'content_glance', minMs: 2500, maxMs: 90000, overridden: false, updatedAt: null, updatedBy: null },
  { operation: 'content_read', minMs: 2500, maxMs: 90000, overridden: false, updatedAt: null, updatedBy: null },
  { operation: 'scroll', minMs: 500, maxMs: 1500, overridden: false, updatedAt: null, updatedBy: null },
  { operation: 'card_gap', minMs: 3000, maxMs: 7000, overridden: false, updatedAt: null, updatedBy: null },
  { operation: 'detail_dwell', minMs: 2500, maxMs: 5000, overridden: false, updatedAt: null, updatedBy: null },
];

const SESSION_LIMITS = {
  maxDurationMin: 30,
  budget: { likes: 5, collects: 3, follows: 2, searches: 4, comments: 2, comment_likes: 2 },
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

const state = vi.hoisted(() => ({
  pacingRows: [] as unknown[],
  getCalls: [] as string[],
  putCalls: [] as Array<{ path: string; body: unknown }>,
  putImpl: (() => Promise.resolve({})) as (path: string, body: unknown) => Promise<unknown>,
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    if (path === '/api/pacing') return Promise.resolve({ pacing: state.pacingRows });
    if (path === '/api/quotas') return Promise.resolve({ quotas: [] });
    if (path === '/api/session-limits') return Promise.resolve(SESSION_LIMITS);
    if (path === '/api/resume-config') return Promise.resolve(RESUME_CONFIG);
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

/** 定位某 op 行（按操作类别中文标签），返回其 <tr>。 */
async function pacingRow(label: string): Promise<HTMLElement> {
  const cell = await screen.findByText(label);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> for ${label}`);
  return tr as HTMLElement;
}

describe('QuotasPage 节奏兜底块', () => {
  beforeEach(() => {
    state.pacingRows = PACING_ROWS.map((r) => ({ ...r }));
    state.getCalls = [];
    state.putCalls = [];
    state.putImpl = () => Promise.resolve({ pacing: state.pacingRows });
  });

  it('渲染每 op 生效值 + 已覆盖/系统默认 Tag', async () => {
    renderPage();

    const actionTr = await pacingRow('互动动作');
    expect(within(actionTr).getByText('1500')).toBeTruthy();
    expect(within(actionTr).getByText('4000')).toBeTruthy();
    expect(within(actionTr).getByText('已覆盖')).toBeTruthy(); // overridden=true

    const cardGapTr = await pacingRow('图片翻页');
    expect(within(cardGapTr).getByText('3000')).toBeTruthy();
    expect(within(cardGapTr).getByText('7000')).toBeTruthy();
    expect(within(cardGapTr).getByText('系统默认')).toBeTruthy(); // overridden=false

    const contentReadTr = await pacingRow('正文阅读');
    expect(within(contentReadTr).getByText('90000')).toBeTruthy();
  });

  it('本地闸：最大 < 最小×1.5 → 保存禁用；回到合法值 → 启用', async () => {
    renderPage();
    const cardGapTr = await pacingRow('图片翻页');
    fireEvent.click(within(cardGapTr).getByRole('button', { name: /编\s*辑/ }));

    const dialog = await screen.findByRole('dialog');
    const okBtn = () => within(dialog).getByRole('button', { name: /保\s*存/ }) as HTMLButtonElement;
    // 初始 min=3000/max=7000（7000 ≥ 4500）→ 可保存。
    expect(okBtn().disabled).toBe(false);

    const spins = within(dialog).getAllByRole('spinbutton'); // [0]=最小 [1]=最大
    // 最大压到 4000 < 3000×1.5=4500 → 展宽不足 → 禁用。
    fireEvent.change(spins[1], { target: { value: '4000' } });
    await waitFor(() => expect(okBtn().disabled).toBe(true));

    // 回到 9000（≥4500）→ 重新可保存。
    fireEvent.change(spins[1], { target: { value: '9000' } });
    await waitFor(() => expect(okBtn().disabled).toBe(false));
  });

  it('写非乐观：保存成功 → PUT 携正确 body + invalidate 重取 /api/pacing', async () => {
    renderPage();
    const cardGapTr = await pacingRow('图片翻页');
    // 首次加载已取一次 /api/pacing。
    await waitFor(() => expect(state.getCalls.filter((p) => p === '/api/pacing').length).toBe(1));

    fireEvent.click(within(cardGapTr).getByRole('button', { name: /编\s*辑/ }));
    const dialog = await screen.findByRole('dialog');
    const spins = within(dialog).getAllByRole('spinbutton');
    fireEvent.change(spins[1], { target: { value: '9000' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/pacing',
        body: { operation: 'card_gap', minMs: 3000, maxMs: 9000 },
      }),
    );
    // 非乐观：成功后 invalidate → 再次拉取真态（/api/pacing 被重取）。
    await waitFor(() => expect(state.getCalls.filter((p) => p === '/api/pacing').length).toBeGreaterThanOrEqual(2));
  });
});
