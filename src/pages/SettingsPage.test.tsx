import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';
import type { InteractionPermissionOverview, ModelConfig } from '../types/api';

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
  config: undefined as unknown,
  permissions: undefined as unknown,
  permissionError: false,
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    if (path === '/api/config/model') return Promise.resolve(state.config);
    if (path === '/api/config/interaction-permissions') {
      return state.permissionError ? Promise.reject(new Error('unavailable')) : Promise.resolve(state.permissions);
    }
    return Promise.reject(new Error(`unexpected apiGet ${path}`));
  }),
  apiPut: vi.fn(() => Promise.resolve({})),
}));

function makeModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    textProvider: 'dashscope',
    imageProvider: 'dashscope',
    textModel: 'qwen-plus',
    imageModel: 'wan2.7-image-pro',
    providers: [
      { id: 'dashscope', displayName: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { id: 'volcengine', displayName: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    ],
    imageProviders: [
      { id: 'dashscope', displayName: '通义万相' },
      { id: 'volcengine', displayName: '火山即梦 Seedream' },
    ],
    credentials: [
      {
        provider: 'dashscope',
        field: 'dashscope_api_key',
        label: '通义千问 API Key',
        providerLabel: '通义千问',
        group: 'model_api',
        groupLabel: '模型 API Key',
        secretKind: 'api_key',
        restartRequired: true,
        configured: true,
        maskedHint: 'sk-***abcd',
        source: 'db',
      },
      {
        provider: 'aliyun',
        field: 'access_key_id',
        label: '阿里云平台 AccessKey ID',
        providerLabel: '阿里云平台',
        group: 'billing_access',
        groupLabel: '账单查询 AccessKey',
        secretKind: 'access_key_id',
        restartRequired: true,
        configured: false,
        maskedHint: null,
        source: 'none',
      },
      {
        provider: 'aliyun',
        field: 'access_key_secret',
        label: '阿里云平台 AccessKey Secret',
        providerLabel: '阿里云平台',
        group: 'billing_access',
        groupLabel: '账单查询 AccessKey',
        secretKind: 'access_key_secret',
        restartRequired: true,
        configured: false,
        maskedHint: null,
        source: 'none',
      },
    ],
    canEditCredential: true,
    ...overrides,
  };
}

function makePermissionOverview(): InteractionPermissionOverview {
  return {
    permissions: [
      { key: 'interaction.config.view', name: '查看配置', description: '查看视频号互动配置。', users: ['admin', 'ops'] },
      { key: 'interaction.config.edit', name: '编辑配置', description: '修改并保存配置草稿。', users: ['admin'] },
      { key: 'interaction.config.publish', name: '发布配置', description: '发布正式生效版本。', users: ['admin'] },
      { key: 'interaction.config.preview', name: '模拟预览', description: '运行无副作用预览。', users: ['admin'] },
      { key: 'interaction.dm.view_full', name: '查看完整私信', description: '查看完整私信正文。', users: [] },
      { key: 'interaction.audit.view', name: '查看审计', description: '查看配置审计记录。', users: ['admin'] },
    ],
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

describe('SettingsPage 平台凭据输入', () => {
  beforeEach(() => {
    state.config = makeModelConfig();
    state.permissions = makePermissionOverview();
    state.permissionError = false;
  });

  it('AccessKey ID 与 Secret 使用独立输入状态', async () => {
    renderPage();

    const idInput = (await screen.findByLabelText('输入阿里云平台 AccessKey ID')) as HTMLInputElement;
    const secretInput = (await screen.findByLabelText('输入阿里云平台 AccessKey Secret')) as HTMLInputElement;

    expect(idInput.name).not.toBe(secretInput.name);

    fireEvent.change(idInput, { target: { value: 'ak-id-123' } });
    expect(idInput.value).toBe('ak-id-123');
    expect(secretInput.value).toBe('');

    fireEvent.change(secretInput, { target: { value: 'ak-secret-456' } });
    expect(idInput.value).toBe('ak-id-123');
    expect(secretInput.value).toBe('ak-secret-456');
  });

  it('只读展示六项视频号权限、说明和有效用户', async () => {
    renderPage();

    const title = await screen.findByText('视频号权限设置');
    const card = title.closest('.ant-card');
    expect(card).toBeTruthy();
    const scope = within(card as HTMLElement);
    expect(scope.getByText('只读')).toBeTruthy();
    expect(scope.getAllByText('admin')).toHaveLength(5);
    expect(scope.getByText('ops')).toBeTruthy();
    expect(scope.getByText('暂无已授权用户')).toBeTruthy();
    for (const permission of makePermissionOverview().permissions) {
      expect(scope.getByText(permission.key)).toBeTruthy();
      expect(scope.getByText(permission.description)).toBeTruthy();
    }
    expect(scope.queryByRole('button', { name: /编辑|保存|新增|删除/ })).toBeNull();
  });

  it('权限概览失败时在卡片内诚实报错，不遮蔽模型设置', async () => {
    state.permissionError = true;
    renderPage();

    expect(await screen.findByText('视频号权限加载失败')).toBeTruthy();
    expect(screen.getByText('模型与厂商')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();
  });
});
