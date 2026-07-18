import { App as AntdApp } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptchaAssistPage } from './CaptchaAssistPage';
import type { CaptchaAssistIncident } from '../types/api';

const incident: CaptchaAssistIncident = {
  incidentId: 'cap-1',
  edgeId: 'edge-1',
  accountId: 'acc-1',
  machineLabel: 'ads-k1e0awu5',
  kind: 'captcha',
  status: 'ready',
  riskStatus: 'restricted',
  detectedAt: 1,
  updatedAt: 2,
  expiresAt: 999999,
  snapshot: {
    incidentId: 'cap-1',
    edgeId: 'edge-1',
    snapshotId: 'snap-1',
    capturedAt: 2,
    kind: 'captcha',
    viewport: { width: 100, height: 100 },
    crop: { x: 0, y: 0, width: 100, height: 100 },
    image: { mime: 'image/png', data: 'iVBORw0KGgo=', width: 100, height: 100 },
  },
};

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={['/captcha-assist/cap-1?token=scoped']}>
        <Routes>
          <Route path="/captcha-assist/:incidentId" element={<CaptchaAssistPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptchaAssistPage', () => {
  it('loads incident with scoped token and submits normalized click points', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/click')) {
        return new Response(JSON.stringify({ ok: true, sent: 1, incident: { ...incident, status: 'click_pending' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ incident }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = renderPage();
    await screen.findByText('待处理');
    expect(screen.getByText('restricted')).toBeTruthy();
    expect(screen.getAllByText('ads-k1e0awu5').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/captcha-assist/cap-1?token=scoped');

    const stage = view.container.querySelector('.captcha-assist-stage') as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    fireEvent.click(stage, { clientX: 50, clientY: 75 });
    fireEvent.click(screen.getByRole('button', { name: /提交/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/click'))).toBe(true));
    const clickCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/click'))!;
    expect(clickCall[0]).toBe('/api/captcha-assist/cap-1/click?token=scoped');
    expect(JSON.parse(String((clickCall[1] as RequestInit).body))).toEqual({
      snapshotId: 'snap-1',
      points: [{ x: 0.25, y: 0.75 }],
    });
  });

  // change captcha-assist-live-snapshot：选点期冻结 + 新帧提示。
  function makeLiveFetch() {
    let currentId = 'snap-1';
    const inc = (id: string): CaptchaAssistIncident => ({
      ...incident,
      status: 'ready',
      snapshot: { ...incident.snapshot!, snapshotId: id, image: { ...incident.snapshot!.image, data: `data-${id}` } },
    });
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/capture')) {
        currentId = 'snap-2'; // 手动刷新后下一帧变为 snap-2
        return new Response(JSON.stringify({ ok: true, sent: 1, incident: inc(currentId) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/click')) {
        return new Response(JSON.stringify({ ok: true, sent: 1, incident: { ...inc(currentId), status: 'click_pending' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ incident: inc(currentId) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  }

  function pinFirstPoint(view: ReturnType<typeof renderPage>) {
    const stage = view.container.querySelector('.captcha-assist-stage') as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    fireEvent.click(stage, { clientX: 50, clientY: 75 });
  }

  it('选点后冻结：新帧到达显示新帧提示，提交仍用被冻结的帧', async () => {
    const fetchMock = makeLiveFetch();
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage();
    await screen.findByText('待处理');

    pinFirstPoint(view); // pin snap-1
    // 手动刷新拉到 snap-2（模拟实时新帧到达），冻结中不换画面、出「画面已更新」提示。
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await screen.findByText('画面已更新，挑战可能已变');

    // 提交用的是被冻结的 snap-1，而非最新的 snap-2。
    fireEvent.click(screen.getByRole('button', { name: /提交/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/click'))).toBe(true));
    const clickCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/click'))!;
    expect(JSON.parse(String((clickCall[1] as RequestInit).body)).snapshotId).toBe('snap-1');
  });

  it('「看最新画面」解冻并清点、提示消失', async () => {
    const fetchMock = makeLiveFetch();
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage();
    await screen.findByText('待处理');

    pinFirstPoint(view);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await screen.findByText('画面已更新，挑战可能已变');

    fireEvent.click(screen.getByRole('button', { name: /看最新画面/ }));
    await waitFor(() => expect(screen.queryByText('画面已更新，挑战可能已变')).toBeNull());
    expect(screen.getByText('点位 0/2')).toBeTruthy();
  });

  // change captcha-assist-trajectory-replay：移动+点击的轨迹随 /click 上送。
  it('采集鼠标移动轨迹并随 click 上送（clicks 对齐落点）', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 50)); // 每次前进 50ms > 节流 40ms
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/click')) {
        return new Response(JSON.stringify({ ok: true, sent: 1, incident: { ...incident, status: 'click_pending' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ incident }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = renderPage();
    await screen.findByText('待处理');
    const stage = view.container.querySelector('.captcha-assist-stage') as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    // 6 次移动（各不同坐标）+ 1 次点击。jsdom 的 fireEvent.pointerMove 不带 clientX，
    // 用真实 MouseEvent('pointermove') 派发以携带坐标。
    for (let i = 0; i < 6; i++) {
      fireEvent(stage, new MouseEvent('pointermove', { clientX: 20 + i * 10, clientY: 30 + i * 5, bubbles: true }));
    }
    fireEvent.click(stage, { clientX: 50, clientY: 75 });
    fireEvent.click(screen.getByRole('button', { name: /提交/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/click'))).toBe(true));
    const clickCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/click'))!;
    const body = JSON.parse(String((clickCall[1] as RequestInit).body)) as {
      snapshotId: string;
      points: unknown[];
      trajectory?: { v: number; samples: { x: number; y: number; t: number }[]; clicks: number[] };
    };
    expect(body.trajectory).toBeTruthy();
    expect(body.trajectory!.v).toBe(1);
    expect(body.trajectory!.samples.length).toBeGreaterThanOrEqual(5);
    // clicks 长度 === 落点数，且下标指向真实样本（点击样本在末尾）。
    expect(body.trajectory!.clicks.length).toBe(1);
    expect(body.trajectory!.clicks[0]).toBe(body.trajectory!.samples.length - 1);
    // t 单调非降、归一坐标在 [0,1]。
    const ts = body.trajectory!.samples.map((s) => s.t);
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1])).toBe(true);
    expect(body.trajectory!.samples.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)).toBe(true);
  });

  // ── change captcha-assist-text-answer：键入答案 ─────────────────────────────
  function staticFetch() {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/click')) {
        return new Response(JSON.stringify({ ok: true, sent: 1, incident: { ...incident, status: 'click_pending' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ incident }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  it('无落点时答案框 disabled；点中 1 个落点后可用（不变量长在控件上）', async () => {
    vi.stubGlobal('fetch', staticFetch());
    const view = renderPage();
    await screen.findByText('待处理');
    const answer = screen.getByLabelText('验证码答案') as HTMLInputElement;
    expect(answer.disabled).toBe(true);

    pinFirstPoint(view);
    await waitFor(() => expect((screen.getByLabelText('验证码答案') as HTMLInputElement).disabled).toBe(false));
  });

  it('键入答案 + 提交：body 带 text/submit，且答案绝不出现在任何 fetch URL', async () => {
    const fetchMock = staticFetch();
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage();
    await screen.findByText('待处理');
    pinFirstPoint(view);
    const answer = await screen.findByLabelText('验证码答案');
    fireEvent.change(answer, { target: { value: 'A7q9' } });
    fireEvent.click(screen.getByRole('button', { name: /提交/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/click'))).toBe(true));
    const clickCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/click'))!;
    const body = JSON.parse(String((clickCall[1] as RequestInit).body)) as { text?: string; submit?: string; points: unknown[] };
    expect(body.text).toBe('A7q9');
    expect(body.submit).toBe('enter'); // 「回车提交」默认开
    expect(body.points).toEqual([{ x: 0.25, y: 0.75 }]);
    // 答案绝不进 URL（design D10）：所有 fetch 的 URL 都不含答案明文。
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('A7q9');
    }
  });

  it('打字期画面冻结：点 1 个点 + 键入后，新帧到达仍出「画面已更新」提示', async () => {
    const fetchMock = makeLiveFetch();
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage();
    await screen.findByText('待处理');
    pinFirstPoint(view); // pin snap-1
    const answer = await screen.findByLabelText('验证码答案');
    fireEvent.change(answer, { target: { value: '12' } });
    // 手动刷新拉到 snap-2：打字期仍冻结在 snap-1，出「画面已更新」提示。
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await screen.findByText('画面已更新，挑战可能已变');
  });

  it('纯点击提交体与今天逐字节一致（零回归：无 text/submit 字段）', async () => {
    const fetchMock = staticFetch();
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage();
    await screen.findByText('待处理');
    pinFirstPoint(view);
    fireEvent.click(screen.getByRole('button', { name: /提交/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/click'))).toBe(true));
    const clickCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/click'))!;
    // 无答案 ⇒ 提交体只含 snapshotId + points，绝不出现 text/submit（与轨迹同「全有或全无」纪律）。
    expect(JSON.parse(String((clickCall[1] as RequestInit).body))).toEqual({ snapshotId: 'snap-1', points: [{ x: 0.25, y: 0.75 }] });
  });
});
