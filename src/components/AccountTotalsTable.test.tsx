import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AccountTotals } from '../types/api';
import type { RiskAction } from '../types/aidcp-enums';
import { RISK_ACTIONS } from '../types/aidcp-enums';
import { AccountTotalsTable } from './AccountTotalsTable';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
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

const zeros = (): Record<RiskAction, number> =>
  Object.fromEntries(RISK_ACTIONS.map((a) => [a, 0])) as Record<RiskAction, number>;

const row = (
  accountId: string,
  totals: Partial<Record<RiskAction, number>>,
  quotas?: Partial<Record<RiskAction, number>>,
): AccountTotals => ({
  accountId,
  totals: { ...zeros(), ...totals },
  quotas: quotas ? { ...zeros(), ...quotas } : undefined,
});

const summaryRow = (): HTMLElement => {
  const cell = screen.getByText(/^合计（/);
  const tr = cell.closest('tr');
  if (!tr) throw new Error('summary row not found');
  return tr;
};

const renderTable = (rows: AccountTotals[]) =>
  render(
    <MemoryRouter>
      <AccountTotalsTable rows={rows} />
    </MemoryRouter>,
  );

describe('AccountTotalsTable 汇总行', () => {
  it('每列按账号加和，上限也加和', () => {
    renderTable([
      row('a', { like: 13, view: 78 }, { like: 50, view: 150 }),
      row('b', { like: 3, view: 17 }, { like: 50, view: 150 }),
    ]);
    const tr = summaryRow();
    expect(within(tr).getByText('合计（2 个账号）')).toBeTruthy();
    expect(within(tr).getByText('16')).toBeTruthy(); // like: 13 + 3
    expect(within(tr).getByText('/ 100')).toBeTruthy(); // like cap: 50 + 50
    expect(within(tr).getByText('95')).toBeTruthy(); // view: 78 + 17
    expect(within(tr).getByText('/ 300')).toBeTruthy(); // view cap: 150 + 150
  });

  it('部分账号取不到上限时只加已知部分，并标记为不完整', () => {
    renderTable([row('a', { like: 5 }, { like: 50 }), row('b', { like: 7 })]);
    const tr = summaryRow();
    expect(within(tr).getByText('12')).toBeTruthy();
    // 缺上限的账号不按 0 计入，也不借用别人的上限：只报「已知之和」并加 + 表示不完整。
    expect(within(tr).getByText(/\/ 50\+/)).toBeTruthy();
  });

  it('全表取不到上限时只显用量之和', () => {
    renderTable([row('a', { like: 5 }), row('b', { like: 7 })]);
    const tr = summaryRow();
    expect(within(tr).getByText('12')).toBeTruthy();
    expect(within(tr).queryByText(/\//)).toBeNull();
  });

  it('无数据时不出汇总行', () => {
    renderTable([]);
    expect(screen.queryByText(/^合计（/)).toBeNull();
  });
});
