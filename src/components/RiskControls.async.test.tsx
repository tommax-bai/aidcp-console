/**
 * 风控写异步化后的四态渲染（cloud change cloud-coupling-phase5 · P5-1，用户 2026-07-25 拍板）。
 *
 * 提交只回一个 commandId，真正的写发生在自动化侧的单写者身上。于是「提交成功」与「写成功」
 * 变成了两件事，界面 MUST 把它们分开——否则操作员看到绿色的「已改为受限」，而命令可能还在队列里、
 * 甚至已经失败（红线：静默假成功）。
 *
 * 四条不变量，一条都不能合并：
 *   1. applied   → 成功文案，且状态取自单写者回读的真态；
 *   2. failed    → 报错并把原因显示出来；
 *   3. unknown   → 报错。它**不是**「还在处理」：提交那一步就没落住；
 *   4. 轮询超时 → 如实说「仍在处理中」，MUST NOT 报成功。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotaTierControl, RiskStatusControl } from './RiskControls';
import type { PanelAccount } from '../types/api';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiPost: vi.fn(), apiGet: vi.fn() };
});
vi.mock('../api/riskCommand', async () => {
  const actual = await vi.importActual<typeof import('../api/riskCommand')>('../api/riskCommand');
  return { ...actual, awaitRiskCommand: vi.fn() };
});
const { apiPost } = await import('../api/client');
const { awaitRiskCommand } = await import('../api/riskCommand');

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

/** 点开档位下拉并选「保守」，触发一次提交。 */
async function submitQuotaChange() {
  fireEvent.click(screen.getByRole('button', { name: /调整档位/ }));
  fireEvent.click(await screen.findByText('保守'));
}

beforeEach(() => {
  vi.mocked(apiPost).mockReset();
  vi.mocked(awaitRiskCommand).mockReset();
  vi.mocked(apiPost).mockResolvedValue({ accepted: true, commandId: 'cmd-1' });
});

describe('风控写异步化：四态各走各的文案', () => {
  it('applied → 成功，且文案里的档位取自单写者回读的真态', async () => {
    vi.mocked(awaitRiskCommand).mockResolvedValue({
      commandId: 'cmd-1', state: 'applied', decidedAt: 1, status: 'normal', quotaLevel: 'conservative',
    });
    renderWith(<QuotaTierControl account={account()} />);
    await submitQuotaChange();
    await waitFor(() => expect(screen.getByText('配额档位已改为 保守')).toBeTruthy());
  });

  it('failed → 报错并显示具名原因，绝不显示成功', async () => {
    vi.mocked(awaitRiskCommand).mockResolvedValue({
      commandId: 'cmd-1', state: 'failed', decidedAt: 2, reason: 'recovery_window_not_elapsed',
    });
    renderWith(<QuotaTierControl account={account()} />);
    await submitQuotaChange();
    await waitFor(() => expect(screen.getByText(/recovery_window_not_elapsed/)).toBeTruthy());
    expect(screen.queryByText(/已改为/)).toBeNull();
  });

  it('unknown → 报错，MUST NOT 渲染成「处理中」', async () => {
    vi.mocked(awaitRiskCommand).mockResolvedValue({ commandId: 'cmd-1', state: 'unknown' });
    renderWith(<QuotaTierControl account={account()} />);
    await submitQuotaChange();
    await waitFor(() => expect(screen.getByText(/没有被受理/)).toBeTruthy());
    expect(screen.queryByText(/仍在处理中/)).toBeNull();
    expect(screen.queryByText(/已改为/)).toBeNull();
  });

  it('轮询到超时仍是 processing → 如实说仍在处理，绝不报成功', async () => {
    vi.mocked(awaitRiskCommand).mockResolvedValue({ commandId: 'cmd-1', state: 'processing' });
    renderWith(<QuotaTierControl account={account()} />);
    await submitQuotaChange();
    await waitFor(() => expect(screen.getByText(/仍在处理中/)).toBeTruthy());
    expect(screen.queryByText(/已改为/)).toBeNull();
  });

  it('状态迁移同样走四态：applied 时显示单写者回读的真实状态', async () => {
    vi.mocked(awaitRiskCommand).mockResolvedValue({
      commandId: 'cmd-1', state: 'applied', decidedAt: 3, status: 'restricted', quotaLevel: 'normal',
    });
    renderWith(<RiskStatusControl account={account()} />);
    fireEvent.click(screen.getByRole('button', { name: /调整风控/ }));
    fireEvent.click(await screen.findByText('受限'));
    await waitFor(() => expect(screen.getByText('风控状态已改为 受限')).toBeTruthy());
  });
});
