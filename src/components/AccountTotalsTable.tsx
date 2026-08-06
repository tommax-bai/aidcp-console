import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RISK_ACTIONS, RISK_ACTION_LABEL, labelOf, type RiskAction } from '../types/aidcp-enums';
import type { AccountTotals, PanelAccount } from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';
import { ProfileLink } from './ProfileLink';
import { STICKY_TABLE_HEADER } from './tableSticky';

/**
 * 真按账号今日计数切片（V1 task 9.6 / 10.3）。
 * 归因已在事件上流通（interaction.occurred 带 accountId），不再标「归因待补」、不再冒充全局。
 * 账号列经客户端 join（change account-real-nickname）：用 accounts 行的「真名→运营名→ID」回落显示，
 * 不加宽服务端 GROUP-BY 总表查询（避免函数依赖坑）；无 accounts 时回落裸 accountId。
 */
/**
 * 列顺序（仅本表的展示口径）：按运营关注度排，与 RISK_ACTIONS 的枚举顺序解耦——
 * 后者是 cloud /api/version 的逐字镜像，顺序被对拍断言钉死，不可为了显示重排。
 * 未在此列出的动作（云端新增、这里忘了排）自动追加到末尾，绝不静默丢列。
 */
const COLUMN_ORDER: readonly RiskAction[] = [
  'view',
  'like',
  'join_group',
  'comment',
  'follow',
  'publish',
  'collect',
  'comment_like',
  'search',
  'dm_reply',
];

/** 实际渲染顺序：先按 COLUMN_ORDER，剩下的按枚举原序补在末尾。列头与汇总行共用同一份，防错位。 */
const ORDERED_ACTIONS: readonly RiskAction[] = [
  ...COLUMN_ORDER.filter((a) => RISK_ACTIONS.includes(a)),
  ...RISK_ACTIONS.filter((a) => !COLUMN_ORDER.includes(a)),
];

export function AccountTotalsTable({
  rows,
  accounts,
  loading,
  stickyHeader = false,
}: {
  rows: AccountTotals[];
  /** 账号一览（DashboardSummary.accounts）：用于把账号列从裸 ID 显示成真名（客户端 join，可选）。 */
  accounts?: PanelAccount[];
  loading?: boolean;
  /** 表头吸顶：长表下滚时列头停在顶栏下方，滚出表格范围即随表格离开。默认关。 */
  stickyHeader?: boolean;
}) {
  const nameOf = (accountId: string): string => {
    const a = accounts?.find((x) => x.accountId === accountId);
    return a ? accountDisplayName(a) : accountId;
  };
  const columns: ColumnsType<AccountTotals> = [
    {
      title: '账号',
      key: 'accountId',
      fixed: 'left',
      // 账号名可点：跳转其小红书主页（accountId = xhs userid）。非真实 id 回落纯文本。
      render: (_, r) => <ProfileLink userId={r.accountId}>{nameOf(r.accountId)}</ProfileLink>,
    },
    ...ORDERED_ACTIONS.map((a) => ({
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
      sticky={stickyHeader ? STICKY_TABLE_HEADER : undefined}
      locale={{ emptyText: '今日暂无按账号计数' }}
      summary={(pageRows) =>
        pageRows.length === 0 ? null : (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>合计（{pageRows.length} 个账号）</strong>
            </Table.Summary.Cell>
            {ORDERED_ACTIONS.map((a, i) => {
              const used = pageRows.reduce((s, r) => s + (r.totals[a] ?? 0), 0);
              // 上限求和只累计「拿得到上限」的账号：某账号上限缺省时，把它算成 0 会虚报余量，
              // 算成别的账号的值更是无中生有——只加已知的那几个，含义是「已知上限之和」。
              const withCap = pageRows.filter((r) => r.quotas?.[a] !== undefined);
              const cap = withCap.reduce((s, r) => s + (r.quotas?.[a] ?? 0), 0);
              return (
                <Table.Summary.Cell key={a} index={i + 1} align="right">
                  <strong>{used}</strong>
                  {withCap.length > 0 && (
                    <span
                      style={{ color: '#bfbfbf' }}
                      title={
                        withCap.length < pageRows.length
                          ? `仅 ${withCap.length}/${pageRows.length} 个账号取到上限，合计为已知部分之和`
                          : undefined
                      }
                    >
                      {' / '}
                      {cap}
                      {withCap.length < pageRows.length && '+'}
                    </span>
                  )}
                </Table.Summary.Cell>
              );
            })}
          </Table.Summary.Row>
        )
      }
    />
  );
}
