/**
 * RolesPage 枚举漂移不 white-screen 回归。
 *
 * 背景：云端 role-catalog 注册了 llmKind:'vision' 的角色（publish:CoverFormSensor，change
 * textcard-cover-form），其 effectiveSource 解析为 'vision'。控制台 KIND_LABEL / SOURCE_TAG 曾
 * 只覆盖 text|image|none / …|image，遇 'vision' 时 MAP['vision'].color 读到 undefined.color →
 * 整个角色配置页 "Unexpected Application Error!" white-screen。
 *
 * 本用例：
 *  1) 带 'vision' 角色的 /api/roles 数据能渲染出「视觉模型」「视觉全局」标签、不抛错（真 bug 修复）。
 *  2) 一个当前枚举里没有的未来值（模拟又一次云端↔控制台类型漂移）经 tagOf 诚实回落成灰底原值
 *     标签、页面照常渲染，不再 throw（自愈不自残的兜底层）。
 * 只 mock HTTP 客户端层，页面 + react-query 走真实渲染路径。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RolesPage } from './RolesPage';
import type { RoleConfigRow } from '../types/api';

// jsdom 无 matchMedia / 只读 getComputedStyle 伪元素分支；antd 响应式 + Table 需最小桩。
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

const baseRole: RoleConfigRow = {
  roleId: 'browse:content_evaluator',
  displayName: '列表页卡片择选',
  group: 'browse',
  category: 'browse_judge',
  llmKind: 'text',
  tunableTemperature: false,
  effectiveModel: 'qwen-turbo',
  effectiveProvider: 'dashscope',
  effectiveSource: 'default',
  modelOverridden: false,
  temperatureOverride: null,
  effectiveThinkingMode: 'default',
  thinkingModeOverride: null,
  thinkingModeSource: 'default',
  thinkingOnAvailable: false,
  updatedAt: null,
  updatedBy: null,
};

// 现役视觉角色：llmKind + effectiveSource 都是 'vision'（旧代码在此 white-screen）。
const visionRole: RoleConfigRow = {
  ...baseRole,
  roleId: 'publish:CoverFormSensor',
  displayName: '封面形态感知',
  group: 'publish',
  category: 'publish_create',
  llmKind: 'vision',
  effectiveModel: 'qwen-vl-max',
  effectiveSource: 'vision',
};

// 又一次未来漂移：控制台类型尚未收录的枚举值——只应触发 tagOf 灰底回落，绝不 throw。
const futureDriftRole = {
  ...baseRole,
  roleId: 'publish:AudioSensor',
  displayName: '未来音频角色',
  llmKind: 'audio',
  effectiveSource: 'audio',
} as unknown as RoleConfigRow;

const state = vi.hoisted(() => ({ roles: [] as RoleConfigRow[] }));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    if (path === '/api/roles') return Promise.resolve({ roles: state.roles });
    if (path === '/api/categories') return Promise.resolve({ categories: [] });
    if (path === '/api/config/model') return Promise.resolve({ providers: [] });
    if (path === '/api/accounts') return Promise.resolve({ accounts: [] });
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn(() => Promise.resolve({})),
}));

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <RolesPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

async function roleRow(displayName: string): Promise<HTMLElement> {
  const cell = await screen.findByText(displayName);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> for ${displayName}`);
  return tr as HTMLElement;
}

describe('RolesPage 枚举漂移', () => {
  beforeEach(() => {
    state.roles = [];
  });

  it("渲染 llmKind:'vision' 角色为「视觉模型」「视觉全局」标签，不 white-screen", async () => {
    state.roles = [baseRole, visionRole];
    renderPage();

    const tr = await roleRow('封面形态感知');
    // 类型列 = KIND_LABEL['vision']；当前生效模型列内 = SOURCE_TAG['vision']。二者旧代码都会 throw。
    expect(within(tr).getByText('视觉模型')).toBeTruthy();
    expect(within(tr).getByText('视觉全局')).toBeTruthy();
    // 普通文本角色仍正常。
    expect(await screen.findByText('列表页卡片择选')).toBeTruthy();
  });

  it('未知枚举值经 tagOf 灰底回落显示原值、页面照常渲染', async () => {
    state.roles = [baseRole, futureDriftRole];
    renderPage();

    const tr = await roleRow('未来音频角色');
    // 类型列 + 生效来源列都回落成原值 'audio' 标签（不抛错、不吞成假值）。
    expect(within(tr).getAllByText('audio').length).toBeGreaterThanOrEqual(2);
    // 页面整体存活：其它角色正常渲染。
    expect(await screen.findByText('列表页卡片择选')).toBeTruthy();
  });
});

describe('RolesPage 使用阶段 tab 分组', () => {
  beforeEach(() => {
    state.roles = [];
  });

  const mk = (roleId: string, displayName: string, group: RoleConfigRow['group']): RoleConfigRow => ({
    ...baseRole,
    roleId,
    displayName,
    group,
  });

  it('按 初始化/浏览/互动/撰写 归 tab，表头计数正确，未知 roleId 按 group 兜底进撰写', async () => {
    state.roles = [
      mk('browse:persona_generator', '建号人设生成', 'browse'), // 初始化
      mk('browse:content_evaluator', '列表页卡片择选', 'browse'), // 浏览
      mk('browse:interaction_appraiser', '点赞收藏判定', 'browse'), // 互动
      mk('browse:comment_composer', '评论文案撰写', 'browse'), // 撰写
      mk('publish:FutureUnmappedRole', '未来发布角色', 'publish'), // 撰写（group 兜底，不漏 tab）
    ];
    renderPage();

    // 四个 tab 表头带计数；撰写含 comment_composer + 兜底的未来发布角色 = 2。
    expect(await screen.findByText('初始化（1）')).toBeTruthy();
    expect(screen.getByText('浏览（1）')).toBeTruthy();
    expect(screen.getByText('互动（1）')).toBeTruthy();
    expect(screen.getByText('撰写（2）')).toBeTruthy();
    // forceRender 下所有 tab 行都在 DOM：兜底的未知 publish 角色不被静默丢弃。
    expect(await screen.findByText('未来发布角色')).toBeTruthy();
  });
});
