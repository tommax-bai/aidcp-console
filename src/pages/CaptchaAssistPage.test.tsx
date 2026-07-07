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
});
