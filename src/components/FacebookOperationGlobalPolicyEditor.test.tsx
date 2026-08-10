/**
 * change unify-facebook-global-policy-across-targets 6.3：
 * 这份配置合并成跨全部运行目标唯一一份之后，误改不再被部署目标吸收 —— 同一次保存直接改到线上。
 * 页面标注与写入确认是运营侧唯一的防误闸，两处都必须在（少一处就退回事故当天的状态：
 * 两边各自如实运行、无人报错、只有逐格比对才能发现）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { FacebookOperationGlobalPolicyEditor } from './FacebookOperationGlobalPolicyEditor';
import {
  FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_DETAIL,
  FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_TITLE,
  FACEBOOK_GLOBAL_POLICY_SCOPE_TITLE,
} from './facebookGlobalPolicyScopeNotice';
import type {
  FacebookGroupCommentPolicyView,
  FacebookOperationGlobalPolicyView,
} from '../types/api';

// jsdom 未实现伪元素形态的 getComputedStyle（AntD Modal 量滚动条会传第二参 → 抛错打断 footer 渲染）。丢弃第二参。
const origGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) => origGetComputedStyle(elt)) as typeof window.getComputedStyle;

const bounds = { min: 1, max: 99, default: 5 };
const capBounds = { min: 0, max: 999 };

const globalPolicy: FacebookOperationGlobalPolicyView = {
  executionTarget: 'dev',
  revision: 7,
  schemaVersion: 'fb-global-1',
  cadenceMode: 'fixed',
  rule: { viewsPerLike: 5, joinEveryNRounds: 3 },
  consumption: { viewsPerLike: 4, confirmedLikesPerJoin: 5, confirmedJoinsPerComment: 2 },
  reels: {
    persona: { viewsPerLike: 6, viewsPerFollow: 12 },
    slowStart: { viewsPerLike: 8, viewsPerFollow: 16 },
    rule: { viewsPerFollow: 10 },
    consumption: { viewsPerFollow: 9 },
  },
  slowStart: {
    totalDays: 2,
    dailyCaps: [
      { day: 1, view: 10, like: 2, comment: 0, follow: 1, publish: 0, search: 1, joinGroup: 0 },
      { day: 2, view: 20, like: 4, comment: 1, follow: 2, publish: 0, search: 2, joinGroup: 1 },
    ],
  },
  bounds: {
    rule: { viewsPerLike: bounds, joinEveryNRounds: bounds },
    consumption: {
      viewsPerLike: bounds,
      confirmedLikesPerJoin: bounds,
      confirmedJoinsPerComment: bounds,
    },
    reels: {
      persona: { viewsPerLike: bounds, viewsPerFollow: bounds },
      slowStart: { viewsPerLike: bounds, viewsPerFollow: bounds },
      rule: { viewsPerFollow: bounds },
      consumption: { viewsPerFollow: bounds },
    },
    slowStart: {
      totalDays: { min: 1, max: 14, default: 7 },
      dailyCaps: {
        view: capBounds,
        like: capBounds,
        comment: capBounds,
        follow: capBounds,
        publish: capBounds,
        search: capBounds,
        joinGroup: capBounds,
      },
    },
  },
  updatedAt: '2026-08-03T00:00:00.000Z',
  updatedBy: 'panel:alice',
};

const groupCommentPolicy: FacebookGroupCommentPolicyView = {
  joinToFirstCommentHours: 72,
  revision: 4,
  source: 'db',
  bounds: { joinToFirstCommentHours: { min: 1, max: 168, default: 24 } },
  sameGroupRecommentCooldownHours: 72,
  sameGroupRecommentCooldownSource: 'default',
  updatedAt: '2026-08-03T00:00:00.000Z',
  updatedBy: 'panel:alice',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderEditor() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/groups/comment-policy')) {
      return new Response(JSON.stringify(groupCommentPolicy), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = init?.method === 'PUT'
      ? { ...globalPolicy, revision: globalPolicy.revision + 1 }
      : globalPolicy;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
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
      <App><FacebookOperationGlobalPolicyEditor /></App>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('FacebookOperationGlobalPolicyEditor', () => {
  it('states on the card that the values apply to every run target including OL', async () => {
    renderEditor();

    expect(await screen.findByText(FACEBOOK_GLOBAL_POLICY_SCOPE_TITLE)).toBeTruthy();
    expect(screen.getByText(/dev 与线上（OL）会同时换用新值/)).toBeTruthy();
  });

  it('repeats the cross-target warning in the save confirmation before writing', async () => {
    const fetchMock = renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: '编辑全局数值' }));
    const field = await screen.findByLabelText('全局规则模式浏览点赞阈值');
    fireEvent.change(field, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '保存全局数值' }));

    expect(await screen.findByText(FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_TITLE)).toBeTruthy();
    expect(screen.getByText(FACEBOOK_GLOBAL_POLICY_SCOPE_CONFIRM_DETAIL)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'))
      .toBe(false);

    fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(true));
  });

  it('switching to probabilistic mode submits cadenceMode in the PUT body', async () => {
    const fetchMock = renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: '编辑全局数值' }));
    // Segmented option 「概率触发」切换节奏模式。
    fireEvent.click(await screen.findByText('概率触发'));
    fireEvent.click(screen.getByRole('button', { name: '保存全局数值' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put?.[1] as RequestInit).body));
      expect(body.cadenceMode).toBe('probabilistic');
    });
  });
});
