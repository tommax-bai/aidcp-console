/**
 * 当前驱动 target 的只读展示 + 风控写为账号级（change risk-target-follows-active-session）。
 *
 * 归属跟随「当次会话」：哪个客户端此刻握手就归哪个 target（分时、合法），不再有静态占位、
 * 「手动改归属」或「非属主只读」。两条不变量：
 *  - 账号行 MUST 展示「当前由哪个 target 的会话驱动」；无活跃会话 MUST 显示「当前无活跃会话」，
 *    这是纯信息、MUST NOT 据此禁用任何写操作；
 *  - 风控写（状态迁移 / 配额档）是**账号级配置**，任何后台都能改，MUST NOT 因驱动 target 不同而禁用；
 *    普通写失败仍走可辨的失败态，MUST NOT 静默无反应。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  QuotaTierControl,
  RiskStatusControl,
  driverTargetHint,
  driverTargetLabel,
} from './RiskControls';
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

describe('当前驱动 target：只读展示，不做写禁用', () => {
  it('有活跃会话（ol 驱动）→ 行上展示驱动 target，且风控写仍可用（不禁用、不只读）', () => {
    renderWith(<RiskStatusControl account={account({ currentDriverTarget: 'ol' })} />);
    // 纯信息展示：告诉运营现在是哪套云端在驱动
    expect(screen.getByTestId('risk-driver-target')).toBeTruthy();
    expect(screen.getByText('ol 驱动中')).toBeTruthy();
    // 账号级写：即便由 ol 会话驱动，本后台仍能调整风控（可点按钮在，无只读包裹）
    expect(screen.getByRole('button', { name: /调整风控/ })).toBeTruthy();
    expect(screen.queryByTestId('risk-readonly')).toBeNull();
  });

  it('无活跃会话 → 展示「当前无活跃会话」，MUST NOT 伪装成某个 target', () => {
    renderWith(<RiskStatusControl account={account({ currentDriverTarget: null })} />);
    expect(screen.getByText('当前无活跃会话')).toBeTruthy();
    expect(driverTargetLabel(account({ currentDriverTarget: null }))).toBe('当前无活跃会话');
    expect(driverTargetHint(account({ currentDriverTarget: null }))).toMatch(/没有任何会话/);
  });

  it('字段缺失（旧 Cloud，未返回该字段）→ 安全降级为「当前无活跃会话」，不崩', () => {
    expect(driverTargetLabel(account())).toBe('当前无活跃会话');
    renderWith(<QuotaTierControl account={account()} />);
    // 配额档写照常可用（账号级，从不因驱动 target 禁用）
    expect(screen.getByRole('button', { name: /调整档位/ })).toBeTruthy();
  });

  it('驱动 target 与本后台不同也照常可写：档位控件保持可点', () => {
    renderWith(<QuotaTierControl account={account({ currentDriverTarget: 'dev' })} />);
    expect(screen.getByRole('button', { name: /调整档位/ })).toBeTruthy();
    expect(screen.queryByTestId('risk-readonly')).toBeNull();
  });
});

describe('风控写失败：可辨失败态（账号级写，无归属分支吞掉）', () => {
  it('写失败 → 走通用错误文案，绝不显示成功、绝不静默', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(500, 'internal'));
    renderWith(<QuotaTierControl account={account({ currentDriverTarget: 'ol' })} />);
    fireEvent.click(screen.getByRole('button', { name: /调整档位/ }));
    fireEvent.click(await screen.findByText('保守'));

    await waitFor(() => {
      expect(screen.getByText('配额档位修改失败')).toBeTruthy();
    });
    expect(screen.queryByText(/已改为/)).toBeNull();
  });
});
