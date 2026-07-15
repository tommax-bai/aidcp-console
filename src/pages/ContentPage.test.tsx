/**
 * change console-cloud-panel-hardening #32：内容审批 CAS 链前端测试。
 * 只 mock HTTP 客户端层（apiGet/apiPost/apiPut），页面 + react-query 走真实渲染与调用路径；
 * 断言拒因经 errorText（#31）呈现为**说人话中文**、绝不把英文机器码（version_stale 等）直接上屏。
 *
 * 关键：mock 工厂经 vi.importActual 保留真实 ApiError 类，使 errorText 的 `err instanceof ApiError`
 * 与测试里 `new ApiError(...)` 命中同一个类（否则 instanceof 恒 false、拒因映射被跳过）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentPage } from './ContentPage';
import { ApiError, apiPost, apiPut } from '../api/client';
import type { PanelPublish } from '../types/api';

// jsdom 无 matchMedia / ResizeObserver；antd Table/Select/Drawer（rc-*）依赖，给最小桩。
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
if (typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  published: { items: [] as unknown[] },
  queue: { status: 'idle', snapshot: null } as { status: string; snapshot: unknown; runs?: unknown[] },
  accounts: { accounts: [] as unknown[] },
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual, // 保留真实 ApiError / UnauthorizedError，使 errorText 的 instanceof 命中同一类
    apiGet: vi.fn((path: string) => {
      if (path.startsWith('/api/accounts')) return Promise.resolve(state.accounts);
      if (path.startsWith('/api/content/published')) return Promise.resolve(state.published);
      if (path === '/api/content/queue') return Promise.resolve(state.queue);
      return Promise.reject(new Error(`unexpected apiGet ${path}`));
    }),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
  };
});

function makePending(overrides: Partial<PanelPublish> = {}): PanelPublish {
  return {
    id: 1,
    title: '测试草稿标题',
    status: 'pending_approval',
    platformPostId: null,
    publishedAt: new Date('2026-07-03T10:00:00').getTime(),
    accountId: 'acc-1',
    accountLabel: '测试账号',
    content: '正文内容',
    postUrl: null,
    contentVersion: 0,
    images: [],
    imageUrl: null,
    imagesAttachedCount: 0,
    imageReferenceAudit: null,
    sourceReference: null,
    ...overrides,
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ContentPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>,
  );
}

/** 渲染 → 等待待审行 → 点整行打开详情浮层（对齐精选页交互；保存草稿按钮出现即编辑态就绪）。 */
async function openEditDrawer(): Promise<void> {
  renderPage();
  fireEvent.click(await screen.findByText('测试草稿标题'));
  await screen.findByText('保存草稿');
}

describe('ContentPage 审批 CAS 链（change console-cloud-panel-hardening #32）', () => {
  beforeEach(() => {
    state.published = { items: [makePending()] };
    state.queue = { status: 'idle', snapshot: null };
    state.accounts = { accounts: [] };
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it('发布队列运行中快照按阶段摘要展示，并保留原始字段', async () => {
    state.published = { items: [] };
    state.queue = {
      status: 'running',
      snapshot: {
        trigger: {
          accountId: 'acc-1',
          generateInput: {
            referenceNote: {
              title: '来稿标题',
              author: '原作者',
              images: [{ index: 0 }, { index: 1 }],
            },
          },
        },
        referenceAnalysis: { thesis: '原稿主旨' },
        faithfulDraft: { title: '洗稿后标题', content: '洗稿后的正文内容' },
        customDebug: { reason: 'keep-me' },
      },
    };

    renderPage();

    expect(await screen.findByText('生成中')).toBeTruthy();
    expect(await screen.findByText('活跃稿件')).toBeTruthy();
    expect(screen.getByText('洗稿后标题')).toBeTruthy();
    expect(screen.getByText('来源：来稿标题')).toBeTruthy();
    expect(screen.getByText('参考图 2 张')).toBeTruthy();
    expect(screen.getByText('洗稿/正文')).toBeTruthy();
    expect(screen.getByText(/已产出：原稿分析、洗稿草稿/)).toBeTruthy();

    fireEvent.click(screen.getByText(/原始字段/));

    expect(await screen.findByText('customDebug')).toBeTruthy();
    expect(await screen.findByText(/keep-me/)).toBeTruthy();
  });

  it('并行多轮：可切换查看每一轮详情，账号显示昵称不裸 id（2026-07-09 用户反馈）', async () => {
    state.published = { items: [] };
    state.accounts = {
      accounts: [{ accountId: 'acc-1', nickname: '小红薯甲', label: null } as unknown],
    };
    const runOf = (runId: string, sourceId: string, title: string, startedAt: number) => ({
      runId,
      accountId: 'acc-1',
      kind: 'rewrite',
      sourceId,
      startedAt,
      status: 'running',
      snapshot: {
        trigger: { accountId: 'acc-1', generateInput: { referenceNote: { title: `来稿-${sourceId}` } } },
        faithfulDraft: { title },
      },
    });
    state.queue = {
      status: 'running',
      snapshot: null, // 聚合字段可为空——有 runs 时详情完全由选中轮驱动
      runs: [runOf('r1', 's1', '甲稿标题', 1), runOf('r2', 's2', '乙稿标题', 2)],
    };

    renderPage();

    // 默认跟随最新启动的一轮（r2）。
    expect(await screen.findByText('乙稿标题')).toBeTruthy();
    // 账号显示昵称（草稿事实 + 阶段 fact 多处），绝不裸 id。
    expect(screen.getAllByText('账号 小红薯甲').length).toBeGreaterThan(0);
    expect(screen.queryByText(/账号 acc-1/)).toBeNull();
    // 切到第一轮（Segmented 首个选项）→ 详情换成甲稿。
    fireEvent.click(screen.getAllByText(/小红薯甲 · 洗稿/)[0]);
    expect(await screen.findByText('甲稿标题')).toBeTruthy();
  });

  it('保存草稿成功 → 「已保存」提示，抽屉保持打开', async () => {
    vi.mocked(apiPut).mockResolvedValue({
      recordId: 1,
      contentVersion: 1,
      title: '测试草稿标题',
      content: '正文内容',
    });
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('已保存')).toBeTruthy();
    // 保存成功不关抽屉（viewing 未清空）：底部按钮仍在。
    expect(screen.getByText('保存草稿')).toBeTruthy();
    // 携带打开时快照版本做 CAS（expectedVersion=0）。
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/publish/1/draft', {
      expectedVersion: 0,
      title: '测试草稿标题',
      content: '正文内容',
    });
  });

  it('版本冲突（version_stale）→ 呈现中文拒因、绝不上屏英文码', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'version_stale'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('内容已更新，请刷新后重新审批')).toBeTruthy();
    expect(screen.queryByText('version_stale')).toBeNull();
  });

  it('版本冲突（version_conflict）→ 中文拒因', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'version_conflict'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('内容已被他处修改，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
  });

  it('already_decided → 中文拒因', async () => {
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'already_decided'));
    await openEditDrawer();
    fireEvent.click(screen.getByText('保存草稿'));
    expect(await screen.findByText('该草稿正在审批处理中，请刷新')).toBeTruthy();
    expect(screen.queryByText('already_decided')).toBeNull();
  });

  it('已发布行点整行 → 笔记详情浮层：正文保留换行、配图渲染、详情页链接', async () => {
    state.published = {
      items: [
        makePending({
          status: 'published',
          title: '已发布标题',
          content: '第一段\n第二段',
          platformPostId: 'post-9',
          postUrl: 'https://www.xiaohongshu.com/explore/post-9?xsec_token=tok',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imagesAttachedCount: 1,
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('已发布标题'));
    // 浮层就绪：出现详情页跳转按钮（非编辑态无 保存草稿）。
    const openBtn = await screen.findByRole('link', { name: '打开小红书详情页' });
    expect(openBtn.getAttribute('href')).toContain('xsec_token');
    expect(screen.queryByText('保存草稿')).toBeNull();
    // 正文整段（含换行）在同一文本节点里（pre-wrap 渲染）；testing-library 默认归一化会折叠 \n，
    // 故用自定义 matcher 直查元素原始 textContent。
    const body = await screen.findByText((_c, el) => el?.textContent === '第一段\n第二段');
    expect(body.textContent).toContain('\n');
    // 配图以 <img> 渲染（OSS 公读链接直挂）。
    const img = document.querySelector('img[src*="aidcp.oss-cn-beijing"]');
    expect(img).toBeTruthy();
    expect(screen.getByText(/配图 1 张（发布时实际附着 1 张）/)).toBeTruthy();
    expect(screen.queryByText(/当前图片厂商不支持参考图/)).toBeNull();
    expect(screen.queryByText(/图片模型已实际使用参考图/)).toBeNull();
  });

  it('页面已提交但未取得链接 → 显示待链接确认，不伪装成已发布或失败', async () => {
    state.published = { items: [makePending({ status: 'submitted', title: '待链接确认帖子' })] };
    renderPage();
    expect(await screen.findByRole('row', { name: /测试账号.*待链接确认帖子.*已提交，待链接确认/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /测试账号.*待链接确认帖子.*已发布/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /测试账号.*待链接确认帖子.*失败/ })).toBeNull();
  });

  it('参照洗稿配图审计：unsupported 明确提示按文本重新生成', async () => {
    state.published = {
      items: [
        makePending({
          status: 'pending_approval',
          title: '洗稿待审标题',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imageReferenceAudit: {
            requestedCount: 2,
            usableCount: 2,
            status: 'unsupported',
            providerClaimedUsed: false,
            generatedCount: 1,
          },
          sourceReference: {
            kind: 'curated_reference',
            curatedContentId: 7,
            accountId: 'acc-1',
            sourceId: 'note-42',
            title: '来稿标题',
            body: '来稿正文',
            author: '原作者',
            topics: [],
            sourceUrl: null,
            capturedAt: new Date('2026-07-03T09:00:00').getTime(),
          },
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('洗稿待审标题'));
    expect(await screen.findByText(/参考图 2 张；当前图片厂商不支持参考图，配图已按文本重新生成/)).toBeTruthy();
  });

  it('参照洗稿配图审计：used 明确提示图片模型已使用参考图', async () => {
    state.published = {
      items: [
        makePending({
          status: 'pending_approval',
          title: '已用参考图标题',
          images: ['https://aidcp.oss-cn-beijing.aliyuncs.com/publish/acc-1/run/1.jpeg'],
          imageReferenceAudit: {
            requestedCount: 1,
            usableCount: 1,
            status: 'used',
            providerClaimedUsed: true,
            generatedCount: 1,
          },
        }),
      ],
    };
    renderPage();
    fireEvent.click(await screen.findByText('已用参考图标题'));
    expect(await screen.findByText(/参考图 1 张；图片模型已实际使用参考图生成新图/)).toBeTruthy();
  });

  it('视觉审计区分 provider used 与保真未核验，并展示逐槽绑定和原因', async () => {
    state.published = { items: [makePending({
      title: '视觉审计草稿',
      images: ['https://oss.test/out.jpg'],
      imageReferenceAudit: { requestedCount: 1, usableCount: 1, status: 'used', providerClaimedUsed: true, generatedCount: 1 },
      visualReferenceAudit: {
        analysisStatus: 'analyzed', analysisCacheKey: 'k', bindingMode: 'slot', auditEnabled: true,
        slots: [{
          slot: 0, route: 'specialized_generative', styleSource: 'reference_analysis', providerReferenceStatus: 'used',
          binding: { slot: 0, mode: 'slot', primarySourceArrayIndex: 0, primarySourceIndex: 7, references: [{ sourceArrayIndex: 0, sourceIndex: 7, url: 'https://ref.test/a.jpg', role: 'primary' }] },
          outputUrl: 'https://oss.test/out.jpg', finalStatus: 'unverified',
          attempts: [{ status: 'unverified', reason: 'vision timeout', auditedAt: 1 }],
        }],
      },
    })] };
    renderPage();
    fireEvent.click(await screen.findByText('视觉审计草稿'));
    expect(await screen.findByText(/0 槽通过，1 槽未核验/)).toBeTruthy();
    expect(screen.queryByText(/保真核验通过/)).toBeNull();
    fireEvent.click(screen.getByText('查看逐槽视觉审计'));
    expect(await screen.findByText(/主参考：源图 #7；尝试 1 次；vision timeout/)).toBeTruthy();
    expect(screen.getByText('未经视觉核验')).toBeTruthy();
  });

  it('保存并批准 → 先编辑(CAS) 再按快照版本授权发布', async () => {
    vi.mocked(apiPut).mockResolvedValue({
      recordId: 1,
      contentVersion: 1,
      title: '测试草稿标题',
      content: '正文内容',
    });
    vi.mocked(apiPost).mockResolvedValue({ written: true });
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '保存并批准' }));
    // Popconfirm 确认（zhCN → 「确定」；antd 会在两个中文字间插空格 → 用 /确\s*定/ 容差匹配）。
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(await screen.findByText('已授权发布')).toBeTruthy();
    // 授权携带编辑回读后的内容版本快照（「审=发」凭证），requestId 由记录 id 派生。
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/publish/publish-1/approve', {
      approved: true,
      contentVersion: 1,
    });
  });

  it('驳回成功后列表状态立即变为已否决', async () => {
    vi.mocked(apiPost).mockImplementation(async () => {
      state.published = { items: [makePending({ status: 'needs_review' })] };
      return { written: true };
    });
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: /驳\s*回/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(await screen.findByText('已驳回')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /测试账号.*测试草稿标题.*已否决/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /测试账号.*测试草稿标题.*待审/ })).toBeNull();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/publish/publish-1/approve', {
      approved: false,
      contentVersion: 0,
    });
  });

  it('参照洗稿行展示来稿件入口；点击来源不打开发布详情', async () => {
    state.published = {
      items: [
        makePending({
          status: 'published',
          title: '洗稿后标题',
          content: '发布正文',
          sourceReference: {
            kind: 'curated_reference',
            curatedContentId: 7,
            accountId: 'acc-1',
            sourceId: 'note-42',
            title: '来稿标题',
            body: '来稿第一段\n来稿第二段',
            author: '原作者',
            topics: ['收纳', '家居'],
            sourceUrl: null,
            capturedAt: new Date('2026-07-03T09:00:00').getTime(),
          },
        }),
      ],
    };
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /洗稿.*来稿标题/ }));
    expect(await screen.findByText('洗稿来稿')).toBeTruthy();
    expect(screen.getByText('原作者')).toBeTruthy();
    const body = await screen.findByText((_c, el) => el?.textContent === '来稿第一段\n来稿第二段');
    expect(body.textContent).toContain('\n');
    expect(screen.getByText('#收纳')).toBeTruthy();
    expect(screen.getByText('无来源链接')).toBeTruthy();
    expect(screen.queryByText('回执：')).toBeNull();
  });

  it('普通发布不展示洗稿来源入口', async () => {
    state.published = { items: [makePending({ status: 'published', title: '普通发布' })] };
    renderPage();
    await screen.findByText('普通发布');
    expect(screen.queryByRole('button', { name: /洗稿/ })).toBeNull();
  });
});

describe('ContentPage 待审配图删除（change pending-draft-image-delete）', () => {
  beforeEach(() => {
    state.queue = { status: 'idle', snapshot: null };
    state.accounts = { accounts: [] };
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it('删一张配图 → 携保留子集走 draft CAS，回读真态刷新、提示已删除', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg', 'https://c.jpg'], imageUrl: 'https://a.jpg' })] };
    vi.mocked(apiPut).mockResolvedValue({
      recordId: 1,
      contentVersion: 1,
      title: '测试草稿标题',
      content: '正文内容',
      images: ['https://b.jpg', 'https://c.jpg'],
    });
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('已删除该配图')).toBeTruthy();
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/publish/1/draft', {
      expectedVersion: 0,
      images: ['https://b.jpg', 'https://c.jpg'],
    });
  });

  it('删最后一张 → 二次确认提示纯文字帖 + 成功提示 + 发空 images', async () => {
    state.published = { items: [makePending({ images: ['https://only.jpg'], imageUrl: 'https://only.jpg' })] };
    vi.mocked(apiPut).mockResolvedValue({ recordId: 1, contentVersion: 1, title: '测试草稿标题', content: '正文内容', images: [] });
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    expect(await screen.findByText('删除最后一张配图？该帖将作为纯文字帖发布')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('已删除；本帖将作为纯文字帖发布')).toBeTruthy();
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/publish/1/draft', { expectedVersion: 0, images: [] });
  });

  it('删配图版本冲突 → 中文拒因、绝不上屏英文码', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg'], imageUrl: 'https://a.jpg' })] };
    vi.mocked(apiPut).mockRejectedValue(new ApiError(409, 'version_conflict'));
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('内容已被他处修改，请刷新后重试')).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
  });

  it('删配图 invalid_field（防注入/过期）→ 中文拒因', async () => {
    state.published = { items: [makePending({ images: ['https://a.jpg', 'https://b.jpg'], imageUrl: 'https://a.jpg' })] };
    vi.mocked(apiPut).mockRejectedValue(new ApiError(400, 'invalid_field'));
    await openEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '删除配图 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }));
    expect(await screen.findByText('提交内容不合法或已过期，请刷新后重试')).toBeTruthy();
  });

  it('已发布记录（查看态）不显示删除入口', async () => {
    state.published = { items: [makePending({ status: 'published', title: '已发布帖', images: ['https://a.jpg'], imageUrl: 'https://a.jpg' })] };
    renderPage();
    fireEvent.click(await screen.findByText('已发布帖'));
    await screen.findByText('无链接');
    expect(screen.queryByRole('button', { name: /删除配图/ })).toBeNull();
  });
});
