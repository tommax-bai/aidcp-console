/**
 * ContentSchedulePage 交互回归：
 *  1) 乐观更新——拨「总开关」在服务器回执之前开关就翻（point-and-flip，不等两趟网络往返）；失败回滚到真态。
 *  2) 子开关显示「有效态」= 总开关 && 本开关——总开关关时子开关统一显示为关（不写库、保留记忆），
 *     消除「总开关关后子开关仍显示开却灰掉、关不掉」的假象。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染 / mutation 路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    operatorAlias: null,
    displayName: '昵称A',
    displayNameSource: 'platform_nickname',
    autoEnabled: true,
    postEnabled: true,
    postMode: 'review',
    postDailyCap: 3,
    commentEnabled: false,
    commentMode: 'off',
    commentDailyCap: 0,
    contactCommentEnabled: false,
    contactCommentMode: 'off',
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

async function renderSchedule(): Promise<void> {
  renderPage();
  await screen.findByText('昵称A'); // 等表格渲染出数据（catalog 从 loading→data）
}

function totalSwitch(): HTMLElement {
  return screen.getByRole('switch');
}

function modeControl(label: string): HTMLElement {
  return screen.getByLabelText(label);
}

function selectedMode(label: string): string | null {
  return modeControl(label).querySelector('.ant-segmented-item-selected')?.textContent ?? null;
}

describe('ContentSchedulePage 乐观开关 + 有效态联动', () => {
  beforeEach(() => {
    state.rows = [makeRow()];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('初始：总开关开 → 自动发帖显示有效态开（勾选）', async () => {
    await renderSchedule();
    expect(totalSwitch().getAttribute('aria-checked')).toBe('true'); // 总开关
    expect(selectedMode('自动发帖 acc-1')).toBe('开'); // 自动发帖（有效态 true && review）
  });

  it('乐观：拨关总开关，在服务器回执之前开关就翻，且子开关同帧灭（有效态联动）', async () => {
    // apiPut 永挂——证明开关翻转不依赖网络往返完成。
    let resolvePut: (() => void) | null = null;
    state.putImpl = () =>
      new Promise<unknown>((resolve) => {
        resolvePut = () => resolve({});
      });

    await renderSchedule();
    fireEvent.click(totalSwitch()); // 拨关总开关

    // 服务器尚未回执（putImpl 仍挂起），但开关必须已经翻到「关」：
    await waitFor(() => expect(totalSwitch().getAttribute('aria-checked')).toBe('false'));
    // 子开关有效态联动：总开关关 → 自动发帖同帧显示关（尽管其存储值 postEnabled 仍为 true）。
    expect(selectedMode('自动发帖 acc-1')).toBe('关');
    // 确已发出写请求，但请求还没回来（乐观，不等网络）。
    expect(state.putCalls).toEqual([{ path: '/api/content-schedule/acc-1', body: { autoEnabled: false } }]);
    expect(resolvePut).not.toBeNull();
  });

  it('失败回滚：apiPut 拒绝 → 开关弹回真态（开）', async () => {
    state.putImpl = () => Promise.reject(new Error('boom'));

    await renderSchedule();
    fireEvent.click(totalSwitch()); // 拨关总开关

    // 乐观先翻关，onError 回滚后弹回开；onSettled invalidate 重取仍是 autoEnabled=true。
    await waitFor(() => expect(totalSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(selectedMode('自动发帖 acc-1')).toBe('开');
  });

  it('假象消除：总开关关但 postEnabled 记忆为 true → 子开关显示关且禁用（不显示「开着却关不掉」）', async () => {
    state.rows = [makeRow({ autoEnabled: false, postEnabled: true, postMode: 'review' })];
    await renderSchedule();
    expect(totalSwitch().getAttribute('aria-checked')).toBe('false'); // 总开关关
    expect(selectedMode('自动发帖 acc-1')).toBe('关'); // 自动发帖：有效态关（记忆值 review 被隐藏、不写库）
    expect(modeControl('自动发帖 acc-1').className).toContain('ant-segmented-disabled'); // 且禁用——不给「想关却关不掉」的操作面
  });

  it('三档：自动评论选免审 → PUT commentMode=auto_approve，非旧 boolean', async () => {
    state.putImpl = () => new Promise(() => {});
    await renderSchedule();
    fireEvent.click(within(modeControl('自动评论 acc-1')).getByText('免审'));
    await waitFor(() =>
      expect(state.putCalls).toEqual([
        { path: '/api/content-schedule/acc-1', body: { commentMode: 'auto_approve' } },
      ]),
    );
    expect(selectedMode('自动评论 acc-1')).toBe('免审');
  });
});
