import { Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ProfileLink } from './ProfileLink';
import { QueryError } from './QueryGate';
import { RISK_ACTION_LABEL, RISK_ACTION_COLOR, labelOf, type RiskAction } from '../types/aidcp-enums';
import type { PanelInteraction } from '../types/api';

function makeColumns(nameOf: (id: string) => string): ColumnsType<PanelInteraction> {
  return [
    {
      title: '时间',
      dataIndex: 'interactedAt',
      key: 'when',
      render: (v: number) => new Date(v).toLocaleString(),
    },
    {
      title: '账号',
      dataIndex: 'accountId',
      key: 'accountId',
      // 账号名可点：跳转其小红书主页（v = accountId = xhs userid）。非真实 id 回落纯文本。
      render: (v: string) => <ProfileLink userId={v}>{nameOf(v)}</ProfileLink>,
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      render: (v: string) => (
        <Tag color={RISK_ACTION_COLOR[v as RiskAction]}>{labelOf(RISK_ACTION_LABEL, v)}</Tag>
      ),
    },
    {
      // 笔记动作=笔记标题→详情页；关注=作者昵称→主页。诚实置空：无链接显纯文本、无标题回落裸 id，绝不渲染死链。
      title: (
        <Tooltip title="笔记/作者链接含时效令牌，较旧的可能已失效；抓不到真实链接时只显文本、不拼假链">
          <span>目标（笔记/作者）</span>
        </Tooltip>
      ),
      key: 'target',
      render: (_: unknown, r: PanelInteraction) => {
        const label = r.title || r.targetId;
        if (r.url) {
          // 外链可点性同口径（.ext-link）：下划线 + 悬停高亮 + 尾随 ↗（近黑品牌不变）。
          return (
            <a className="ext-link" href={r.url} target="_blank" rel="noreferrer">
              {label}
            </a>
          );
        }
        return r.title ? <Typography.Text>{label}</Typography.Text> : <Typography.Text code>{label}</Typography.Text>;
      },
    },
  ];
}

/**
 * 按笔记互动历史表（merge-monitor-into-dashboard：原「监控」页 V1 task 9.2/10.3 读侧，随监控页并入首页搬出）。
 * 纯呈现组件：数据/加载/失败态由页面注入；失败在空态位诚实呈现并可重试。
 */
export function InteractionsTable({
  rows,
  loading,
  error,
  onRetry,
  nameOf,
}: {
  rows: PanelInteraction[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  nameOf: (id: string) => string;
}) {
  return (
    <Table
      size="small"
      bordered
      rowKey={(r) => `${r.accountId}:${r.action}:${r.targetId}`}
      loading={loading}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      columns={makeColumns(nameOf)}
      dataSource={rows}
      locale={{
        emptyText: error ? <QueryError title="加载互动记录失败" onRetry={onRetry} /> : '暂无互动记录',
      }}
    />
  );
}
