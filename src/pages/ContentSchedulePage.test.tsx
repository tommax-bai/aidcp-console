/**
 * ContentSchedulePage 交互回归：
 *  1) 乐观更新——拨「总开关」在服务器回执之前开关就翻（point-and-flip，不等两趟网络往返）；失败回滚到真态。
 *  2) 子开关显示「有效态」= 总开关 && 本开关——总开关关时子开关统一显示为关（不写库、保留记忆），
 *     消除「总开关关后子开关仍显示开却灰掉、关不掉」的假象。
 *  3) 排期页缺失联系方式可直接补齐；保存前不解锁、成功后收敛、失败保留草稿。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染 / mutation 路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentSchedulePage } from './ContentSchedulePage';
import type { ContentScheduleAvailableAction, ContentScheduleRow } from '../types/api';

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

// rc-table 会以伪元素参数测滚动条；jsdom 对该参数只打印 not-implemented 噪声。
const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => getComputedStyle(element);

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  putImpl: (() => Promise.resolve({})) as (path: string, body: unknown) => Promise<unknown>,
  putCalls: [] as Array<{ path: string; body: unknown }>,
}));

const xiaohongshuActions: ContentScheduleAvailableAction[] = [
  { action: 'post', allowedModes: ['review', 'auto_approve'], maxDailyCap: 50 },
  { action: 'comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 50 },
  { action: 'contact_comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 10 },
];
const FULL_MASK = '1'.repeat(168);

const facebookJoinConfig = {
  enabled: true,
  dailyCap: 2,
  effectiveDailyCap: 1,
  weekMask: null,
  weekMaskSource: 'content' as const,
  effectiveWeekMask: FULL_MASK,
  accountGroupLabel: null,
  scopedTargetCount: 0,
  scopeReady: false,
  recentResult: {
    outcome: 'no_targets',
    reason: 'scope_not_ready',
    groupUrl: null,
    createdAt: '2026-07-22T02:00:00.000Z',
  },
  updatedAt: null,
  updatedBy: null,
};

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
    platform: 'xiaohongshu',
    groupLabel: '测试组',
    label: 'A',
    nickname: '昵称A',
    operatorAlias: null,
    displayName: '昵称A',
    displayNameSource: 'platform_nickname',
    availableActions: xiaohongshuActions,
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
    activeWeekMask: null,
    contentActiveMask: null,
    effectiveActiveWeekMask: null,
    effectiveContentActiveMask: null,
    activeMaskSource: 'global',
    contentMaskSource: 'global',
    hasActiveOverrideMask: false,
    hasContentOverrideMask: false,
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

async function selectPlatform(label: string): Promise<void> {
  fireEvent.click(within(screen.getByLabelText('平台筛选')).getByText(label));
  await waitFor(() => expect(screen.getByLabelText('平台筛选').textContent).toContain(label));
}

async function renderSchedule(platformLabel?: string): Promise<void> {
  renderPage();
  await screen.findByText('昵称A'); // 等表格渲染出数据（catalog 从 loading→data）
  if (platformLabel) await selectPlatform(platformLabel);
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

async function openContactEditor(): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole('button', { name: '未配联系方式（点击添加）' }));
  return screen.findByLabelText('账号 acc-1 联系方式') as Promise<HTMLTextAreaElement>;
}

describe('ContentSchedulePage 平台感知视图', () => {
  beforeEach(() => {
    state.rows = [
      makeRow(),
      makeRow({
        accountId: 'fb-1',
        platform: 'facebook',
        groupLabel: null,
        label: 'FB',
        nickname: 'Facebook账号',
        displayName: 'Facebook账号',
        availableActions: [
          { action: 'post', allowedModes: ['review'], maxDailyCap: 2 },
          { action: 'comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 4 },
          { action: 'contact_comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 10 },
          { action: 'join_group', allowedModes: [], maxDailyCap: 10 },
        ],
        joinGroupAutomation: facebookJoinConfig,
        postDailyCap: 1,
      }),
      makeRow({
        accountId: 'wc-1',
        platform: 'wechat_channels',
        groupLabel: '视频号组',
        label: 'WC',
        nickname: '视频号账号',
        displayName: '视频号账号',
        availableActions: [],
        postEnabled: false,
        postMode: 'off',
        postDailyCap: 0,
      }),
    ];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('默认全部平台只展示公共摘要，并从同一集合计算计数', async () => {
    await renderSchedule();

    expect(screen.getByText('账号自动化')).not.toBeNull();
    expect(screen.getByTestId('platform-filter-count').textContent).toBe('当前 3 / 全部 3 个账号');
    expect(screen.getByText('Facebook账号')).not.toBeNull();
    expect(screen.getByText('视频号账号')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '已启用动作' })).not.toBeNull();
    expect(screen.queryByRole('columnheader', { name: '自动发帖' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '自动评论' })).toBeNull();
    expect(screen.getByText('测试组')).not.toBeNull();
    expect(screen.getAllByText('未分组').length).toBeGreaterThan(0);
  });

  it('选择 Facebook 后只显示过滤行，并按服务端声明限制模式和日上限', async () => {
    await renderSchedule();
    await selectPlatform('Facebook');

    expect(screen.getByTestId('platform-filter-count').textContent).toBe('当前 1 / 全部 3 个账号');
    expect(screen.getByText('Facebook账号')).not.toBeNull();
    expect(screen.queryByText('昵称A')).toBeNull();
    expect(screen.getByRole('columnheader', { name: '自动发帖' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '自动评论' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '自动加群' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '加群评论（联系）' })).not.toBeNull();
    expect(screen.queryByRole('columnheader', { name: '自动联系评论' })).toBeNull();
    expect(modeControl('加群评论（联系） fb-1')).not.toBeNull();
    expect(within(modeControl('自动发帖 fb-1')).queryByText('免审')).toBeNull();
    expect(screen.getByText('/ 2')).not.toBeNull();

    const capInput = screen.getByLabelText('自动发帖日上限 fb-1');
    fireEvent.change(capInput, { target: { value: '2' } });
    fireEvent.blur(capInput);
    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/content-schedule/fb-1',
        body: { postDailyCap: 2 },
      }),
    );
  });

  it('Facebook 自动加群展示服务端有效值、范围就绪态和最近排期结果', async () => {
    await renderSchedule();
    await selectPlatform('Facebook');

    expect(screen.getByText('范围未就绪')).not.toBeNull();
    expect(screen.getByText('账号未归属分组')).not.toBeNull();
    expect(screen.getByText('/ 10，有效 1')).not.toBeNull();
    expect(screen.getByText(/最近执行：no_targets · scope_not_ready/)).not.toBeNull();
    expect(screen.getByText('跟随内容时段')).not.toBeNull();
  });

  it('Facebook 自动加群通过独立端点保存开关与日上限', async () => {
    state.putImpl = (_path, body) =>
      Promise.resolve({ joinGroupAutomation: { ...facebookJoinConfig, ...(body as object) } });
    await renderSchedule();
    await selectPlatform('Facebook');

    const capInput = screen.getByLabelText('自动加群日上限 fb-1');
    fireEvent.change(capInput, { target: { value: '4' } });
    fireEvent.blur(capInput);
    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/content-schedule/fb-1/join-group',
        body: { dailyCap: 4 },
      }),
    );

    fireEvent.click(screen.getByRole('switch', { name: '自动加群 fb-1' }));
    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/content-schedule/fb-1/join-group',
        body: { enabled: false },
      }),
    );
  });

  it('Facebook 自动加群可保存自定义周历', async () => {
    state.putImpl = (_path, body) =>
      Promise.resolve({ joinGroupAutomation: { ...facebookJoinConfig, ...(body as object), weekMaskSource: 'custom' } });
    await renderSchedule();
    await selectPlatform('Facebook');

    fireEvent.click(screen.getByRole('button', { name: '设置时段' }));
    await screen.findByText('自动加群时段：Facebook账号');
    fireEvent.click(screen.getByRole('button', { name: '保存自定义时段' }));

    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/content-schedule/fb-1/join-group',
        body: { weekMask: FULL_MASK },
      }),
    );
  });

  it('Facebook 自动加群可明确恢复继承内容时段', async () => {
    state.rows = state.rows.map((row) =>
      (row as ContentScheduleRow).accountId === 'fb-1'
        ? {
            ...(row as ContentScheduleRow),
            joinGroupAutomation: {
              ...facebookJoinConfig,
              weekMask: FULL_MASK,
              weekMaskSource: 'custom' as const,
            },
          }
        : row,
    );
    state.putImpl = () =>
      Promise.resolve({
        joinGroupAutomation: { ...facebookJoinConfig, weekMask: null, weekMaskSource: 'content' },
      });
    await renderSchedule();
    await selectPlatform('Facebook');

    fireEvent.click(screen.getByRole('button', { name: '编辑时段' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复跟随内容时段' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复跟随' }));

    await waitFor(() =>
      expect(state.putCalls).toContainEqual({
        path: '/api/content-schedule/fb-1/join-group',
        body: { weekMask: null },
      }),
    );
  });

  it('无动作平台仍显示账号，并明确暂无可配置动作', async () => {
    await renderSchedule();
    await selectPlatform('视频号');

    expect(screen.getByText('视频号账号')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: '自动化动作' })).not.toBeNull();
    expect(screen.getByText('暂无可配置自动化动作')).not.toBeNull();
    expect(screen.queryByRole('columnheader', { name: '自动发帖' })).toBeNull();
  });

  it('空平台的表格、计数和空态均来自空过滤集合', async () => {
    state.rows = [makeRow()];
    await renderSchedule();
    await selectPlatform('视频号');

    expect(screen.getByTestId('platform-filter-count').textContent).toBe('当前 0 / 全部 1 个账号');
    expect(await screen.findByText('视频号暂无账号')).not.toBeNull();
    expect(screen.queryByText('昵称A')).toBeNull();
  });
});

describe('ContentSchedulePage 乐观开关 + 有效态联动', () => {
  beforeEach(() => {
    state.rows = [makeRow()];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('初始：总开关开 → 自动发帖显示有效态开（勾选）', async () => {
    await renderSchedule('小红书');
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

    await renderSchedule('小红书');
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

    await renderSchedule('小红书');
    fireEvent.click(totalSwitch()); // 拨关总开关

    // 乐观先翻关，onError 回滚后弹回开；onSettled invalidate 重取仍是 autoEnabled=true。
    await waitFor(() => expect(totalSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(selectedMode('自动发帖 acc-1')).toBe('开');
  });

  it('假象消除：总开关关但 postEnabled 记忆为 true → 子开关显示关且禁用（不显示「开着却关不掉」）', async () => {
    state.rows = [makeRow({ autoEnabled: false, postEnabled: true, postMode: 'review' })];
    await renderSchedule('小红书');
    expect(totalSwitch().getAttribute('aria-checked')).toBe('false'); // 总开关关
    expect(selectedMode('自动发帖 acc-1')).toBe('关'); // 自动发帖：有效态关（记忆值 review 被隐藏、不写库）
    expect(modeControl('自动发帖 acc-1').className).toContain('ant-segmented-disabled'); // 且禁用——不给「想关却关不掉」的操作面
  });

  it('三档：自动评论选免审 → PUT commentMode=auto_approve，非旧 boolean', async () => {
    state.putImpl = () => new Promise(() => {});
    await renderSchedule('小红书');
    fireEvent.click(within(modeControl('自动评论 acc-1')).getByText('免审'));
    await waitFor(() =>
      expect(state.putCalls).toEqual([
        { path: '/api/content-schedule/acc-1', body: { commentMode: 'auto_approve' } },
      ]),
    );
    expect(selectedMode('自动评论 acc-1')).toBe('免审');
  });
});

describe('ContentSchedulePage 账号级活跃与内容排期', () => {
  const ALL_ON = '1'.repeat(168);
  const ALL_OFF = '0'.repeat(168);

  beforeEach(() => {
    state.rows = [makeRow()];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('未配置账号显示跟随全局；添加排期从全局生效值初始化并只原子写账号端点', async () => {
    await renderSchedule();
    expect(screen.getByText('跟随全局')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '添加账号排期 acc-1' }));
    await screen.findByText('编辑账号排期：昵称A');
    expect(screen.getByText('当前跟随全局；编辑器已按当前全局生效值初始化。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '保存账号排期' }));
    await waitFor(() =>
      expect(state.putCalls).toEqual([
        {
          path: '/api/content-schedule/acc-1',
          body: { activeWeekMask: ALL_ON, contentActiveMask: ALL_OFF },
        },
      ]),
    );
  });

  it('账号自定义排期可确认恢复全局，两层覆盖同时清空且不改动作开关', async () => {
    state.rows = [
      makeRow({
        activeWeekMask: ALL_OFF,
        contentActiveMask: ALL_OFF,
        effectiveActiveWeekMask: ALL_OFF,
        effectiveContentActiveMask: ALL_OFF,
        activeMaskSource: 'override',
        contentMaskSource: 'override',
        hasActiveOverrideMask: true,
        hasContentOverrideMask: true,
        maskSource: 'override',
        hasOverrideMask: true,
      }),
    ];
    await renderSchedule();
    expect(screen.getByText('账号自定义')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '编辑账号排期 acc-1' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复全局' }));
    const confirmButtons = await screen.findAllByRole('button', { name: '恢复全局' });
    fireEvent.click(confirmButtons.at(-1)!);

    await waitFor(() =>
      expect(state.putCalls).toEqual([
        {
          path: '/api/content-schedule/acc-1',
          body: { activeWeekMask: null, contentActiveMask: null },
        },
      ]),
    );
  });

  it('账号排期保存失败不关闭编辑器、不伪装成功', async () => {
    state.putImpl = () => Promise.reject(new Error('boom'));
    await renderSchedule();

    fireEvent.click(screen.getByRole('button', { name: '添加账号排期 acc-1' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存账号排期' }));

    await screen.findByText(/账号排期保存失败/);
    expect(screen.getByText('编辑账号排期：昵称A')).not.toBeNull();
    expect(state.putCalls[0]?.path).toBe('/api/content-schedule/acc-1');
  });
});

describe('ContentSchedulePage 缺失联系方式快速配置', () => {
  beforeEach(() => {
    state.rows = [makeRow({ hasContactInfo: false })];
    state.putImpl = () => Promise.resolve({});
    state.putCalls = [];
  });

  it('点击“未配联系方式”在当前排期页直接打开多行编辑器', async () => {
    await renderSchedule('小红书');

    const input = await openContactEditor();

    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: '保存联系方式' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '取消添加联系方式' })).not.toBeNull();
  });

  it('全空白输入只提示、不写入，并保留草稿继续编辑', async () => {
    await renderSchedule('小红书');
    const input = await openContactEditor();
    fireEvent.change(input, { target: { value: '  \n ' } });

    fireEvent.click(screen.getByRole('button', { name: '保存联系方式' }));

    await screen.findByText('请输入联系方式');
    expect(state.putCalls).toEqual([]);
    expect(screen.getByLabelText('账号 acc-1 联系方式')).toHaveProperty('value', '  \n ');
  });

  it('非空正文原样发送；等待回执时不解锁，确认成功后才解除缺失门禁', async () => {
    const contactInfo = '  微信：aidcp\n📱 13800000000  ';
    const deferred: { resolve?: () => void } = {};
    state.putImpl = (_path, body) =>
      new Promise<unknown>((resolve) => {
        deferred.resolve = () => {
          state.rows = [makeRow({ hasContactInfo: true })];
          resolve({ accountId: 'acc-1', contactInfo: (body as { contactInfo: string }).contactInfo });
        };
      });

    await renderSchedule('小红书');
    const input = await openContactEditor();
    fireEvent.change(input, { target: { value: contactInfo } });
    fireEvent.click(screen.getByRole('button', { name: '保存联系方式' }));

    await waitFor(() =>
      expect(state.putCalls).toEqual([
        { path: '/api/accounts/acc-1/contact-info', body: { contactInfo } },
      ]),
    );
    expect(screen.getByRole('button', { name: '保存联系方式' }).textContent).toContain('保存中');
    expect(modeControl('自动联系评论 acc-1').className).toContain('ant-segmented-disabled');

    if (!deferred.resolve) throw new Error('contact save request was not started');
    deferred.resolve();

    await waitFor(() =>
      expect(modeControl('自动联系评论 acc-1').className).not.toContain('ant-segmented-disabled'),
    );
    expect(screen.queryByRole('button', { name: '未配联系方式（点击添加）' })).toBeNull();
    expect(screen.queryByLabelText('账号 acc-1 联系方式')).toBeNull();
  });

  it('保存失败不伪装成功：保留原草稿和编辑器，联系方式门禁继续关闭', async () => {
    state.putImpl = () => Promise.reject(new Error('boom'));

    await renderSchedule('小红书');
    const input = await openContactEditor();
    fireEvent.change(input, { target: { value: '微信：retry-me' } });
    fireEvent.click(screen.getByRole('button', { name: '保存联系方式' }));

    await screen.findByText('联系方式保存失败：请稍后重试');
    expect(screen.getByLabelText('账号 acc-1 联系方式')).toHaveProperty('value', '微信：retry-me');
    expect(modeControl('自动联系评论 acc-1').className).toContain('ant-segmented-disabled');
    expect(screen.getByRole('button', { name: '未配联系方式（点击添加）' })).not.toBeNull();
  });
});
