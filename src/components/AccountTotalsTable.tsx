import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RISK_ACTIONS, RISK_ACTION_LABEL, labelOf } from '../types/aidcp-enums';
import type { AccountTotals, PanelAccount } from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';
import { ProfileLink } from './ProfileLink';

/**
 * 真按账号今日计数切片（V1 task 9.6 / 10.3）。
 * 归因已在事件上流通（interaction.occurred 带 accountId），不再标「归因待补」、不再冒充全局。
 * 账号列经客户端 join（change account-real-nickname）：用 accounts 行的「真名→运营名→ID」回落显示，
 * 不加宽服务端 GROUP-BY 总表查询（避免函数依赖坑）；无 accounts 时回落裸 accountId。
 */
export function AccountTotalsTable({
  rows,
  accounts,
  loading,
}: {
  rows: AccountTotals[];
  /** 账号一览（DashboardSummary.accounts）：用于把账号列从裸 ID 显示成真名（客户端 join，可选）。 */
  accounts?: PanelAccount[];
  loading?: boolean;
}) {
  const nameOf = (accountId: string): string => {
    const a = accounts?.find((x) => x.accountId === accountId);
    return a ? accountDisplayName(a.nickname, a.label, a.accountId) : accountId;
  };
  const columns: ColumnsType<AccountTotals> = [
    {
      title: '账号',
      key: 'accountId',
      fixed: 'left',
      // 账号名可点：跳转其小红书主页（accountId = xhs userid）。非真实 id 回落纯文本。
      render: (_, r) => <ProfileLink userId={r.accountId}>{nameOf(r.accountId)}</ProfileLink>,
    },
    ...RISK_ACTIONS.map((a) => ({
      title: labelOf(RISK_ACTION_LABEL, a),
      key: a,
      align: 'right' as const,
      // 用量可见（change decouple-quota-hit-from-risk）：显示「用了 / 上限」，撞当日上限标红。
      // 上限缺省（后端拿不到 controller）时回落只显用量数字。节奏用量 ≠ 平台风控，配色与风控徽标区分。
      render: (_: unknown, r: AccountTotals) => {
        const used = r.totals[a] ?? 0;
        const cap = r.quotas?.[a];
        if (cap === undefined) return used;
        const hit = r.saturated?.includes(a) ?? used >= cap;
        return (
          <span style={{ color: hit ? '#cf1322' : undefined, fontWeight: hit ? 600 : undefined }}>
            {used}
            <span style={{ color: '#bfbfbf' }}> / {cap}</span>
          </span>
        );
      },
    })),
  ];
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: '今日暂无按账号计数' }}
    />
  );
}
