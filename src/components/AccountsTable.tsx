import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RiskStatusBadge } from './RiskStatusBadge';
import { QuotaTierBadge } from './QuotaTierBadge';
import type { PanelAccount } from '../types/api';
import type { RiskStatus } from '../types/aidcp-enums';

const SEVERITY_ORDER: Record<RiskStatus, number> = { frozen: 0, restricted: 1, warned: 2, normal: 3 };

function severityRank(a: PanelAccount): number {
  return a.riskStatus ? SEVERITY_ORDER[a.riskStatus] : 4;
}

const dash = <Typography.Text type="secondary">—</Typography.Text>;

const columns: ColumnsType<PanelAccount> = [
  { title: 'Account', key: 'account', render: (_, r) => r.label ?? r.accountId },
  { title: 'Group', dataIndex: 'groupLabel', render: (v: string | null) => v ?? dash },
  {
    title: 'Operator',
    dataIndex: 'operatorStatus',
    // 运营暂停态，区别于验证码暂停（不共用一个含糊 paused 徽标）
    render: (v: 'active' | 'paused') =>
      v === 'paused' ? <Tag>Paused by operator</Tag> : <Tag color="green">active</Tag>,
  },
  {
    title: 'Risk status',
    dataIndex: 'riskStatus',
    // 两个独立徽标之一：风控 STATUS
    render: (v: RiskStatus | null) => (v ? <RiskStatusBadge status={v} /> : dash),
  },
  {
    title: 'Quota tier',
    key: 'tier',
    // 两个独立徽标之二：风控 QUOTA-TIER（与 status 永不合并）
    render: (_, r) => (r.riskQuotaLevel ? <QuotaTierBadge tier={r.riskQuotaLevel} /> : dash),
  },
  { title: 'Signals', dataIndex: 'signalCount', render: (v: number | null) => v ?? dash },
];

export function AccountsTable({
  accounts,
  loading,
  severitySorted = false,
}: {
  accounts: PanelAccount[];
  loading?: boolean;
  severitySorted?: boolean;
}) {
  const rows = severitySorted ? [...accounts].sort((a, b) => severityRank(a) - severityRank(b)) : accounts;
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={columns}
      dataSource={rows}
    />
  );
}
