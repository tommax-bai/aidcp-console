import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';
import type { ModelConfig } from '../types/api';

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
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    if (path === '/api/config/model') return Promise.resolve(state.config);
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
});
