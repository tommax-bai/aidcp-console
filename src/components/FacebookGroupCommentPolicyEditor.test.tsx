import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { FacebookGroupCommentPolicyEditor } from './FacebookGroupCommentPolicyEditor';
import {
  FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_DETAIL,
  FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_TITLE,
  FACEBOOK_GROUP_COMMENT_SCOPE_TITLE,
} from './facebookGlobalPolicyScopeNotice';
import type { FacebookGroupCommentPolicyView } from '../types/api';

const policy: FacebookGroupCommentPolicyView = {
  joinToFirstCommentHours: 24,
  revision: 4,
  source: 'db',
  bounds: {
    joinToFirstCommentHours: { min: 1, max: 168, default: 24 },
  },
  sameGroupRecommentCooldownHours: 72,
  sameGroupRecommentCooldownSource: 'default',
  updatedAt: '2026-08-03T00:00:00.000Z',
  updatedBy: 'panel:alice',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderEditor(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })));
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App><FacebookGroupCommentPolicyEditor /></App>
    </QueryClientProvider>,
  );
}

describe('FacebookGroupCommentPolicyEditor', () => {
  it('retains the timing draft on a stale revision conflict', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'revision_conflict', current: policy }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(policy), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderEditor(fetchMock);

    const input = await screen.findByLabelText('入群后首次评论等待（小时）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '36' } });
    fireEvent.click(screen.getByRole('button', { name: '保存首次评论等待' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));

    expect(await screen.findByText(/策略 revision 已变化/)).toBeTruthy();
    expect(input.value).toBe('36');
  });

  it('rejects an out-of-range draft locally', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(policy), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    renderEditor(fetchMock);

    const input = await screen.findByLabelText('入群后首次评论等待（小时）');
    fireEvent.change(input, { target: { value: '169' } });

    expect(await screen.findByText('请输入 1–168 之间的整数小时。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存首次评论等待' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'))
      .toBe(false);
  });

  // 合并成跨目标唯一一份后，这条标注是运营侧唯一的防误闸：页面与写入确认都必须讲明
  // 「这次保存也会改到线上」。少任一处，误改就会像事故那次一样静默改到 OL。
  it('warns on the card and again in the save confirmation that OL changes too', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ ...policy, revision: 5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(policy), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderEditor(fetchMock);

    expect(await screen.findByText(FACEBOOK_GROUP_COMMENT_SCOPE_TITLE)).toBeTruthy();

    const input = await screen.findByLabelText('入群后首次评论等待（小时）');
    fireEvent.change(input, { target: { value: '36' } });
    fireEvent.click(screen.getByRole('button', { name: '保存首次评论等待' }));

    expect(await screen.findByText(FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_TITLE)).toBeTruthy();
    expect(screen.getByText(FACEBOOK_GROUP_COMMENT_SCOPE_CONFIRM_DETAIL)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(true));
  });

  it('renders an unavailable read as unknown instead of a 24-hour default', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'storage_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));
    renderEditor(fetchMock);

    expect(await screen.findByText('群组评论时序状态未知')).toBeTruthy();
    expect(screen.getByText(/未使用默认值冒充服务器真态/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('入群后首次评论等待（小时）')).toBeNull());
  });
});
