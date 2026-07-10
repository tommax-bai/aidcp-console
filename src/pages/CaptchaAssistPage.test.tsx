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
  remoteAddr: 'https://rdp.example/ads-k1e0awu5',
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
});
