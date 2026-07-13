/**
 * FacebookSearchConfig（change facebook-scheduled-comment 2.1）核心交互回归：
 *  - 点开「FB配置」→ apiGet 拉当前配置（正确 path）并回填。
 *  - 保存 → apiPut 到同一 path，body = { keywords, commentMode, commentTemplates }。
 *  - legacy containers 不再展示 / 不再提交。
 * 只 mock HTTP 客户端层，组件 + react-query 走真实路径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FacebookSearchConfig } from './FacebookSearchConfig';
import { IMAGE_UPLOAD_COMPRESSION_TARGET_BYTES } from '../utils/imageUploadCompression';
import type { ImageUploadCompressionRejectReason } from '../utils/imageUploadCompression';
import type { FacebookCommentConfig, FacebookPublishMediaList, PanelAccount } from '../types/api';

// jsdom 未实现 getComputedStyle 的伪元素形态（AntD Modal 量滚动条会传第二参 → 抛错打断 footer 渲染）。丢弃第二参。
const origGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) => origGetComputedStyle(elt)) as typeof window.getComputedStyle;

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
  cfg: {} as FacebookCommentConfig,
  media: {} as FacebookPublishMediaList,
  getCalls: [] as string[],
  putCalls: [] as Array<{ path: string; body: unknown }>,
  postCalls: [] as Array<{ path: string; body: unknown }>,
  patchCalls: [] as Array<{ path: string; body: unknown }>,
  deleteCalls: [] as string[],
  postFailures: [] as string[],
}));

const imageCompression = vi.hoisted(() => ({
  prepareImageForUpload: vi.fn(),
}));

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  apiGet: vi.fn((path: string) => {
    state.getCalls.push(path);
    if (path.endsWith('/facebook-publish-media')) return Promise.resolve(state.media);
    return Promise.resolve(state.cfg);
  }),
  apiPut: vi.fn((path: string, body: unknown) => {
    state.putCalls.push({ path, body });
    return Promise.resolve(state.cfg);
  }),
  apiPost: vi.fn((path: string, body: unknown) => {
    state.postCalls.push({ path, body });
    const filename = ((body as { files?: Array<{ filename?: string }> }).files ?? [])[0]?.filename ?? 'unknown';
    if (state.postFailures.includes(filename)) {
      return Promise.resolve({
        results: [{ ok: false, filename, reason: 'invalid_file', message: '测试上传失败' }],
        view: state.media,
      });
    }
    return Promise.resolve({
      results: [{ ok: true, filename, duplicate: false, set: state.media.sets[0] }],
      view: state.media,
    });
  }),
  apiPatch: vi.fn((path: string, body: unknown) => {
    state.patchCalls.push({ path, body });
    const patch = body as { status?: string; captionHint?: string | null };
    return Promise.resolve({
      ...state.media.sets[0],
      ...('status' in patch ? { status: patch.status } : {}),
      ...('captionHint' in patch ? { captionHint: patch.captionHint } : {}),
    });
  }),
  apiDelete: vi.fn((path: string) => {
    state.deleteCalls.push(path);
    return Promise.resolve({ ...state.media.sets[0], status: 'deleted' });
  }),
}));

vi.mock('../utils/imageUploadCompression', async () => ({
  ...(await vi.importActual<typeof import('../utils/imageUploadCompression')>('../utils/imageUploadCompression')),
  prepareImageForUpload: imageCompression.prepareImageForUpload,
}));

function fbAccount(): PanelAccount {
  return {
    accountId: 'fb-1',
    label: 'FB One',
    nickname: null,
    platform: 'facebook',
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
  };
}

function renderCmp(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <AntdApp>
      <QueryClientProvider client={qc}>
        <FacebookSearchConfig account={fbAccount()} />
      </QueryClientProvider>
    </AntdApp>,
  );
}

function selectFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('image file input not found');
  fireEvent.change(input, { target: { files } });
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function jpegName(name: string): string {
  const withoutExtension = name.replace(/\.[^.\\/]+$/, '');
  return `${withoutExtension || 'image'}.jpg`;
}

function fileWithArrayBuffer(bytes: Uint8Array, name: string, type = 'image/jpeg'): File {
  const buffer = bytesBuffer(bytes);
  const file = new File([buffer], name, { type, lastModified: 123 });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(buffer.slice(0)),
  });
  return file;
}

function mockImageCompression(compressedBytes: Uint8Array) {
  imageCompression.prepareImageForUpload.mockImplementation(async (file: File) => {
    const compressed = fileWithArrayBuffer(compressedBytes, jpegName(file.name), 'image/jpeg');
    return {
      ok: true,
      file: compressed,
      originalName: file.name,
      originalSize: file.size,
      finalSize: compressed.size,
      outputType: 'image/jpeg',
      compressed: true,
    };
  });
  return () => imageCompression.prepareImageForUpload.mockReset();
}

function mockImageCompressionReject(reason: ImageUploadCompressionRejectReason = 'not_smaller') {
  imageCompression.prepareImageForUpload.mockImplementation(async (file: File) => ({
    ok: false,
    originalName: file.name,
    originalSize: file.size,
    reason,
  }));
  return () => imageCompression.prepareImageForUpload.mockReset();
}

describe('FacebookSearchConfig', () => {
  beforeEach(() => {
    state.cfg = {
      accountId: 'fb-1',
      keywords: ['手冲咖啡'],
      // 已识别群名 + 一个待识别（只有 url）的容器。
      containers: [
        { url: 'https://www.facebook.com/groups/123', name: 'Puerto Rico Y Sus Encantos e Historia' },
        { url: 'https://www.facebook.com/groups/456' },
      ],
      commentMode: 'generated',
      commentTemplates: [],
      updatedAt: null,
      updatedBy: null,
    };
    state.media = {
      accountId: 'fb-1',
      statusCounts: { available: 1, reserved: 0, used: 0, disabled: 0, deleted: 0, quarantine: 0 },
      sets: [
        {
          id: 1,
          accountId: 'fb-1',
          status: 'available',
          captionHint: null,
          sortOrder: 1,
          reservedBy: null,
          reservedAt: null,
          usedByPublishLogId: null,
          lastError: null,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
          images: [
            {
              id: 11,
              setId: 1,
              url: 'https://example.com/one.png',
              objectKey: 'facebook-publish-media/fb-1/one.png',
              filename: 'one.png',
              contentType: 'image/png',
              byteSize: 8,
              sha256: 'hash',
              sortOrder: 1,
              duplicateOfImageId: null,
              createdAt: '2026-07-12T00:00:00.000Z',
            },
          ],
        },
      ],
    };
    state.getCalls = [];
    state.putCalls = [];
    state.postCalls = [];
    state.patchCalls = [];
    state.deleteCalls = [];
    state.postFailures = [];
    imageCompression.prepareImageForUpload.mockReset();
  });

  it('点开时回填关键词和评论方式；legacy 群组不再展示', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() =>
      expect(state.getCalls).toContain('/api/accounts/fb-1/facebook-comment-config'),
    );
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    expect(screen.getByText('生成评论')).toBeTruthy();
    expect(screen.getByText('模板评论')).toBeTruthy();
    // 群组已从账号 FB 配置中移除，即使接口仍返回 legacy containers，也不展示给运营。
    expect(screen.queryByText('Puerto Rico Y Sus Encantos e Historia')).toBeNull();
    expect(screen.queryByText('待识别')).toBeNull();
    expect(screen.queryByText('https://www.facebook.com/groups/123')).toBeNull();
  });

  // 注：「关键词含空格不被拆词」是 AntD tags 输入 tokenSeparators 去掉空格后的行为——其 CJK 分词依赖
  //   composition/输入事件序列，jsdom 下靠 fireEvent 无法稳定复现（会误判未创建标签）。该行为转真机验收（簇 49）。

  it('保存生成评论配置 → apiPut body 不再提交 containers', async () => {
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() => expect(screen.getByText('手冲咖啡')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].path).toBe('/api/accounts/fb-1/facebook-comment-config');
    expect(state.putCalls[0].body).toEqual({
      keywords: ['手冲咖啡'],
      commentMode: 'generated',
      commentTemplates: [],
    });
  });

  it('模板评论：回填模板，保存时按行 sanitize/去重', async () => {
    state.cfg = {
      ...state.cfg,
      commentMode: 'template',
      commentTemplates: ['这家手冲咖啡很不错', '这家烘焙咖啡很不错'],
    };
    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    await waitFor(() => expect(screen.getByDisplayValue(/这家手冲咖啡很不错/)).toBeTruthy());
    const textarea = screen.getByDisplayValue(/这家手冲咖啡很不错/) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: ' 这家手冲咖啡很不错 \n\n这家手冲咖啡很不错\n这家拉花咖啡很不错 ',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(state.putCalls.length).toBe(1));
    expect(state.putCalls[0].body).toEqual({
      keywords: ['手冲咖啡'],
      commentMode: 'template',
      commentTemplates: ['这家手冲咖啡很不错', '这家拉花咖啡很不错'],
    });
  });

  it('发帖图片：批量选择后逐张提交到账号素材池', async () => {
    const restoreCompression = mockImageCompression(new Uint8Array([1, 2]));
    try {
      renderCmp();
      fireEvent.click(screen.getByText('FB配置'));
      fireEvent.click(await screen.findByText('发帖图片'));

      await waitFor(() =>
        expect(state.getCalls).toContain('/api/accounts/fb-1/facebook-publish-media'),
      );

      const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'one.png', { type: 'image/png' });
      const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'two.jpg', { type: 'image/jpeg' });
      selectFiles([png, jpg]);

      await waitFor(() => expect(screen.queryByRole('button', { name: /上传图片/ })).not.toBeNull());
      fireEvent.click(screen.getByRole('button', { name: /上传图片/ }));

      await waitFor(() => expect(state.postCalls.length).toBe(2));
      expect(state.postCalls.every((call) => call.path === '/api/accounts/fb-1/facebook-publish-media/upload')).toBe(true);
      expect(
        state.postCalls.map((call) => (call.body as { files: Array<{ filename: string; contentType: string }> }).files.map((file) => [file.filename, file.contentType])),
      ).toEqual([[['one.jpg', 'image/jpeg']], [['two.jpg', 'image/jpeg']]]);
    } finally {
      restoreCompression();
    }
  });

  it('发帖图片：超过 600KB 的图片先压缩，再上传压缩后的内容', async () => {
    const compressedBytes = new Uint8Array([1, 2, 3, 4]);
    const restoreCompression = mockImageCompression(compressedBytes);
    try {
      renderCmp();
      fireEvent.click(screen.getByText('FB配置'));
      fireEvent.click(await screen.findByText('发帖图片'));

      const large = new File([new Uint8Array(IMAGE_UPLOAD_COMPRESSION_TARGET_BYTES + 1024)], 'large.jpg', { type: 'image/jpeg' });
      selectFiles([large]);

      await waitFor(() => expect(screen.queryByRole('button', { name: /上传图片/ })).not.toBeNull());
      fireEvent.click(screen.getByRole('button', { name: /上传图片/ }));

      await waitFor(() => expect(state.postCalls.length).toBe(1));
      const uploaded = (state.postCalls[0].body as { files: Array<{ filename: string; contentType: string; dataBase64: string }> }).files[0];
      expect(uploaded).toEqual({
        filename: 'large.jpg',
        contentType: 'image/jpeg',
        dataBase64: 'AQIDBA==',
      });
    } finally {
      restoreCompression();
    }
  });

  it('发帖图片：单张失败不阻断后续上传，失败文件保留待重试', async () => {
    state.postFailures = ['two.jpg'];
    const restoreCompression = mockImageCompression(new Uint8Array([1, 2]));
    try {
      renderCmp();
      fireEvent.click(screen.getByText('FB配置'));
      fireEvent.click(await screen.findByText('发帖图片'));

      const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'one.png', { type: 'image/png' });
      const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'two.jpg', { type: 'image/jpeg' });
      selectFiles([png, jpg]);
      await waitFor(() => expect(screen.queryByRole('button', { name: /上传图片/ })).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /上传图片/ }));
      await waitFor(() => expect(state.postCalls.length).toBe(2));
      expect(await screen.findByText(/one\.jpg 已入池/)).toBeTruthy();
      expect(await screen.findByText(/two\.jpg 失败：测试上传失败/)).toBeTruthy();
      expect(screen.getByText(/two\.jpg ·/)).toBeTruthy();
    } finally {
      restoreCompression();
    }
  });

  it('发帖图片：无法转成更小 JPEG 的图片不会入队上传', async () => {
    const restoreCompression = mockImageCompressionReject('decode_failed');
    try {
      renderCmp();
      fireEvent.click(screen.getByText('FB配置'));
      fireEvent.click(await screen.findByText('发帖图片'));

      const bad = new File([new Uint8Array([1, 2, 3, 4])], 'bad.png', { type: 'image/png' });
      selectFiles([bad]);

      await waitFor(() => expect(screen.queryByText(/bad\.png/)).toBeNull());
      expect(screen.queryByRole('button', { name: /上传图片/ })).toBeNull();
      expect(state.postCalls).toHaveLength(0);
    } finally {
      restoreCompression();
    }
  });

  it('发帖图片：待人工确认图片可以确认、改备注和删除', async () => {
    state.media = {
      ...state.media,
      statusCounts: { available: 0, reserved: 0, used: 0, disabled: 0, deleted: 0, quarantine: 1 },
      sets: [
        {
          ...state.media.sets[0],
          status: 'quarantine',
          captionHint: null,
          lastError: 'submitted_unconfirmed',
        },
      ],
    };

    renderCmp();
    fireEvent.click(screen.getByText('FB配置'));
    fireEvent.click(await screen.findByText('发帖图片'));

    await screen.findByText('待人工确认');
    const caption = screen.getByPlaceholderText('可选备注') as HTMLInputElement;
    expect(caption.disabled).toBe(false);
    fireEvent.change(caption, { target: { value: '人工确认可用' } });
    fireEvent.blur(caption);
    await waitFor(() =>
      expect(state.patchCalls).toContainEqual({
        path: '/api/accounts/fb-1/facebook-publish-media/sets/1',
        body: { captionHint: '人工确认可用' },
      }),
    );

    const confirmButton = screen.getByRole('button', { name: /确认/ }) as HTMLButtonElement;
    await waitFor(() => expect(confirmButton.disabled).toBe(false));
    fireEvent.click(confirmButton);
    await waitFor(() =>
      expect(state.patchCalls).toContainEqual({
        path: '/api/accounts/fb-1/facebook-publish-media/sets/1',
        body: { status: 'available' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '删除图片' }));
    await screen.findByText('删除这张发帖图片？');
    const deleteButtons = screen.getAllByRole('button', { name: /删\s*除/ });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() =>
      expect(state.deleteCalls).toEqual(['/api/accounts/fb-1/facebook-publish-media/sets/1']),
    );
  });
});
