import type { ReactNode } from 'react';
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RiskStatusBadge } from './RiskStatusBadge';
import { QuotaTierBadge } from './QuotaTierBadge';
import type { PanelAccount } from '../types/api';
import { OPERATOR_STATUS_LABEL, type RiskStatus } from '../types/aidcp-enums';

const SEVERITY_ORDER: Record<RiskStatus, number> = { frozen: 0, restricted: 1, warned: 2, normal: 3 };

function severityRank(a: PanelAccount): number {
  return a.riskStatus ? SEVERITY_ORDER[a.riskStatus] : 4;
}

const dash = <Typography.Text type="secondary">—</Typography.Text>;

const columns: ColumnsType<PanelAccount> = [
  { title: '账号', key: 'account', render: (_, r) => r.label ?? r.accountId },
  { title: '分组', dataIndex: 'groupLabel', render: (v: string | null) => v ?? dash },
  {
    title: '运营',
    dataIndex: 'operatorStatus',
    // 运营暂停态，区别于验证码暂停（不共用一个含糊 paused 徽标）
    render: (v: 'active' | 'paused') =>
      v === 'paused' ? <Tag>{OPERATOR_STATUS_LABEL.paused}</Tag> : <Tag color="green">{OPERATOR_STATUS_LABEL.active}</Tag>,
  },
  {
    title: '风控状态',
    dataIndex: 'riskStatus',
    // 两个独立徽标之一：风控 STATUS
    render: (v: RiskStatus | null) => (v ? <RiskStatusBadge status={v} /> : dash),
  },
  {
    title: '配额档位',
    key: 'tier',
    // 两个独立徽标之二：风控 QUOTA-TIER（与 status 永不合并）
    render: (_, r) => (r.riskQuotaLevel ? <QuotaTierBadge tier={r.riskQuotaLevel} /> : dash),
  },
  { title: '信号数', dataIndex: 'signalCount', render: (v: number | null) => v ?? dash },
];

export function AccountsTable({
  accounts,
  loading,
  severitySorted = false,
  actionsColumn,
}: {
  accounts: PanelAccount[];
  loading?: boolean;
  severitySorted?: boolean;
  /** 可选操作列（如 pause/resume 按钮）；只读视图不传。 */
  actionsColumn?: (account: PanelAccount) => ReactNode;
}) {
  const rows = severitySorted ? [...accounts].sort((a, b) => severityRank(a) - severityRank(b)) : accounts;
  const cols: ColumnsType<PanelAccount> = actionsColumn
    ? [...columns, { title: '操作', key: 'actions', render: (_, r) => actionsColumn(r) }]
    : columns;
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={cols}
      dataSource={rows}
    />
  );
}
