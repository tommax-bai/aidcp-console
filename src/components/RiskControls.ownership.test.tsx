/**
 * 风控写控件的归属可见性（change risk-state-cross-process-integrity，task 8.4）。
 *
 * 两条不变量：
 *  - 非属主账号的风控写操作 MUST 禁用，且真实归属 MUST 直接显示在行上（未归属显示「未归属」，
 *    MUST NOT 伪装成当前后台）；
 *  - 收到 409 的归属拒绝时 MUST 显示可区分的失败态，MUST NOT 显示成功、MUST NOT 静默无反应。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotaTierControl, RiskStatusControl, isRiskWritable, ownershipHint } from './RiskControls';
import { ApiError } from '../api/client';
import type { PanelAccount } from '../types/api';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiPost: vi.fn() };
});
const { apiPost } = await import('../api/client');

function account(over: Partial<PanelAccount> = {}): PanelAccount {
  return {
    accountId: 'acc-1',
    label: 'acc-1',
    nickname: null,
    operatorAlias: null,
    displayName: 'acc-1',
    displayNameSource: 'account_id',
    platform: 'xiaohongshu',
    groupLabel: null,
    machineLabel: null,
    contactInfo: null,
    operatorStatus: 'active',
    pausedAt: null,
    riskStatus: 'normal',
    riskQuotaLevel: 'normal',
    signalCount: 0,
    personaBound: true,
    needsPersonaSetup: false,
    ...over,
  } as PanelAccount;
}

function renderWith(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App>{ui}</App>
    </QueryClientProvider>,
  );
}

describe('非属主账号：风控写操作禁用并显示真实归属', () => {
  it('归属 ol → 两个控件都渲染为只读，且行上直接写着「归属 ol」', () => {
    const acc = account({ executionTarget: 'ol', riskWritable: false });
    const { unmount } = renderWith(<RiskStatusControl account={acc} />);
    expect(screen.getByTestId('risk-readonly')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('归属 ol')).toBeTruthy();
    unmount();

    renderWith(<QuotaTierControl account={acc} />);
    expect(screen.getByTestId('risk-readonly')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('未归属 → 显示「未归属」，MUST NOT 伪装成当前后台', () => {
    renderWith(<RiskStatusControl account={account({ executionTarget: null, riskWritable: false })} />);
    expect(screen.getByText('未归属')).toBeTruthy();
    expect(ownershipHint(account({ executionTarget: null }))).toMatch(/尚未归属/);
  });

  it('属主账号照常可写；字段缺失（旧 Cloud）也按可写处理，不误伤', () => {
    expect(isRiskWritable(account({ riskWritable: true }))).toBe(true);
    expect(isRiskWritable(account())).toBe(true);
    renderWith(<RiskStatusControl account={account({ executionTarget: 'dev', riskWritable: true })} />);
    expect(screen.getByRole('button', { name: /调整风控/ })).toBeTruthy();
  });
});

describe('409 归属拒绝：可区分失败态', () => {
  it('risk_state_not_owned → 原样呈现服务端说明，绝不显示成功', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(
      new ApiError(
        409,
        'risk_state_not_owned',
        undefined,
        undefined,
        undefined,
        '账号 acc-1 归属 ol，请在 ol 的后台操作。',
      ),
    );
    renderWith(<QuotaTierControl account={account({ executionTarget: 'dev', riskWritable: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /调整档位/ }));
    fireEvent.click(await screen.findByText('保守'));

    await waitFor(() => {
      expect(screen.getByText('账号 acc-1 归属 ol，请在 ol 的后台操作。')).toBeTruthy();
    });
    expect(screen.queryByText(/已改为/)).toBeNull();
  });

  it('普通失败仍走通用错误文案（归属分支不吞掉别的失败）', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(500, 'internal'));
    renderWith(<QuotaTierControl account={account({ executionTarget: 'dev', riskWritable: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /调整档位/ }));
    fireEvent.click(await screen.findByText('保守'));

    await waitFor(() => {
      expect(screen.getByText('配额档位修改失败')).toBeTruthy();
    });
  });
});
