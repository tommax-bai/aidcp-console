import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RISK_ACTIONS } from '../types/aidcp-enums';
import type { AccountTotals } from '../types/api';

/**
 * 真按账号今日计数切片（V1 task 9.6 / 10.3）。
 * 归因已在事件上流通（interaction.occurred 带 accountId），不再标「归因待补」、不再冒充全局。
 * 保留键 default 即单账号现实下的真实账号行。
 */
const columns: ColumnsType<AccountTotals> = [
  { title: 'Account', dataIndex: 'accountId', key: 'accountId', fixed: 'left' },
  ...RISK_ACTIONS.map((a) => ({
    title: a,
    key: a,
    align: 'right' as const,
    render: (_: unknown, r: AccountTotals) => r.totals[a] ?? 0,
  })),
];

export function AccountTotalsTable({
  rows,
  loading,
}: {
  rows: AccountTotals[];
  loading?: boolean;
}) {
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: 'no per-account counters today' }}
    />
  );
}
