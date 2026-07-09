/**
 * ContentSchedulePage 交互回归：
 *  1) 乐观更新——拨「总开关」在服务器回执之前开关就翻（point-and-flip，不等两趟网络往返）；失败回滚到真态。
 *  2) 子开关显示「有效态」= 总开关 && 本开关——总开关关时子开关统一显示为关（不写库、保留记忆），
 *     消除「总开关关后子开关仍显示开却灰掉、关不掉」的假象。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染 / mutation 路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentSchedulePage } from './ContentSchedulePage';
import type { ContentScheduleRow } from '../types/api';

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

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  putImpl: (() => Promise.resolve({})) as (path: string, body: unknown) => Promise<unknown>,
  putCalls: [] as Array<{ path: string; body: unknown }>,
}));

vi.mock('../api/client', async () => ({
  // 保留真实 ApiError（errorText 的 `err instanceof ApiError` 依赖它——否则被 mock 成 undefined 会抛）。
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    if (path === '/api/content-schedule') return Promise.resolve({ rows: state.rows });
    if (path === '/api/session-limits') return Promise.resolve({ activeWeekMask: null });
    if (path === '/api/content-schedule/global')
      return Promise.resolve({ contentActiveMask: null, overridden: false });
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    return state.putImpl(path, body);
  }),
}));

function makeRow(overrides: Partial<ContentScheduleRow> = {}): ContentScheduleRow {
  return {
    accountId: 'acc-1',
    label: 'A',
    nickname: '昵称A',
    autoEnabled: true,
    postEnabled: true,
    postDailyCap: 3,
    commentEnabled: false,
    commentDailyCap: 0,
    contactCommentEnabled: false,
    contactCommentDailyCap: 0,
    hasContactInfo: true,
    maskSource: 'global',
    hasOverrideMask: false,
    configured: true,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <ContentSchedulePage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

/** 渲染并按 DOM（=列顺序）返回单行表格的开关：0=总开关 1=自动发帖 2=自动评论 3=自动联系评论。 */
async function switches(): Promise<HTMLElement[]> {
  renderPage();
  return screen.findAllByRole('switch'); // 等表格渲染出开关（catalog 从 loading→data）
}

describe('ContentSchedulePage 乐观开关 + 有效态联动', () => {
  beforeEach(() => {
    state.rows = [makeRow()];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('初始：总开关开 → 自动发帖显示有效态开（勾选）', async () => {
    const sw = await switches();
    expect(sw[0].getAttribute('aria-checked')).toBe('true'); // 总开关
    expect(sw[1].getAttribute('aria-checked')).toBe('true'); // 自动发帖（有效态 true && true）
  });

  it('乐观：拨关总开关，在服务器回执之前开关就翻，且子开关同帧灭（有效态联动）', async () => {
    // apiPut 永挂——证明开关翻转不依赖网络往返完成。
    let resolvePut: (() => void) | null = null;
    state.putImpl = () =>
      new Promise<unknown>((resolve) => {
        resolvePut = () => resolve({});
      });

    const sw = await switches();
    fireEvent.click(sw[0]); // 拨关总开关

    // 服务器尚未回执（putImpl 仍挂起），但开关必须已经翻到「关」：
    await waitFor(() => expect(sw[0].getAttribute('aria-checked')).toBe('false'));
    // 子开关有效态联动：总开关关 → 自动发帖同帧显示关（尽管其存储值 postEnabled 仍为 true）。
    expect(sw[1].getAttribute('aria-checked')).toBe('false');
    // 确已发出写请求，但请求还没回来（乐观，不等网络）。
    expect(state.putCalls).toEqual([{ path: '/api/content-schedule/acc-1', body: { autoEnabled: false } }]);
    expect(resolvePut).not.toBeNull();
  });

  it('失败回滚：apiPut 拒绝 → 开关弹回真态（开）', async () => {
    state.putImpl = () => Promise.reject(new Error('boom'));

    const sw = await switches();
    fireEvent.click(sw[0]); // 拨关总开关

    // 乐观先翻关，onError 回滚后弹回开；onSettled invalidate 重取仍是 autoEnabled=true。
    await waitFor(() => expect(sw[0].getAttribute('aria-checked')).toBe('true'));
    expect(sw[1].getAttribute('aria-checked')).toBe('true');
  });

  it('假象消除：总开关关但 postEnabled 记忆为 true → 子开关显示关且禁用（不显示「开着却关不掉」）', async () => {
    state.rows = [makeRow({ autoEnabled: false, postEnabled: true })];
    const sw = await switches();
    expect(sw[0].getAttribute('aria-checked')).toBe('false'); // 总开关关
    expect(sw[1].getAttribute('aria-checked')).toBe('false'); // 自动发帖：有效态关（记忆值 true 被隐藏、不写库）
    expect((sw[1] as HTMLButtonElement).disabled).toBe(true); // 且禁用——不给「想关却关不掉」的操作面
  });
});
