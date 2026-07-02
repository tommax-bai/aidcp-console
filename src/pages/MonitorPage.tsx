import { useState } from 'react';
import { Badge, Button, Card, Empty, Input, List, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { usePanelWs, type WsStatus } from '../ws/panelWs';
import { useAlerts, useInteractions, useDashboardSummary, useResolveAlert } from '../api/queries';
import { AccountTotalsTable, AlertSeverityBadge, ProfileLink } from '../components';
import { RISK_ACTION_LABEL, RISK_ACTION_COLOR, type RiskAction } from '../types/aidcp-enums';
import { makeAccountNamer } from '../types/accountDisplay';
import type { PanelInteraction } from '../types/api';

const STATUS_BADGE: Record<WsStatus, 'processing' | 'success' | 'warning' | 'default'> = {
  connecting: 'processing',
  live: 'success',
  reconnecting: 'warning',
  offline: 'default',
};

/** WS 连接状态中文 label（内部值不变、渲染中文）。 */
const STATUS_LABEL: Record<WsStatus, string> = {
  connecting: '连接中',
  live: '实时',
  reconnecting: '重连中',
  offline: '离线',
};

function makeInteractionColumns(nameOf: (id: string) => string): ColumnsType<PanelInteraction> {
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
    render: (v: string) => <Tag color={RISK_ACTION_COLOR[v as RiskAction]}>{RISK_ACTION_LABEL[v as RiskAction] ?? v}</Tag>,
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
        return (
          <a href={r.url} target="_blank" rel="noreferrer">
            {label}
          </a>
        );
      }
      return r.title ? <Typography.Text>{label}</Typography.Text> : <Typography.Text code>{label}</Typography.Text>;
    },
  },
  ];
}

/** 运行监控（design PAGE 6）：面板 WS 单一全局流 + 按笔记互动 + 告警只读流 + 真按账号总览（V1 task 10.3）。 */
export function MonitorPage() {
  const { frames, status, setPaused } = usePanelWs();
  const [paused, setPausedState] = useState(false);
  const [filter, setFilter] = useState('');

  const interactions = useInteractions();
  const alerts = useAlerts();
  const resolveAlert = useResolveAlert();
  const summary = useDashboardSummary();
  // 账号名走统一诚实回落（真名→运营名→ID）：互动行/告警只带 accountId，真名从汇总的账号列表 join。
  const nameOf = makeAccountNamer(summary.data?.accounts ?? []);
  const interactionColumns = makeInteractionColumns(nameOf);

  const togglePause = () => {
    const next = !paused;
    setPausedState(next);
    setPaused(next);
  };

  const shown = filter ? frames.filter((f) => f.kind.includes(filter)) : frames;

  return (
    <div className="page-stack">
      <Card size="small">
        <Space wrap>
          <Badge status={STATUS_BADGE[status]} text={`连接：${STATUS_LABEL[status]}`} />
          <Button size="small" onClick={togglePause}>
            {paused ? `恢复（已缓冲 ${frames.length} 条）` : '暂停'}
          </Button>
          <Input
            size="small"
            placeholder="按类型筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Typography.Text type="secondary">
            {shown.length} 条事件（最多 500，单一全局流 · 断连不回填）
          </Typography.Text>
        </Space>
      </Card>

      <Card size="small" title="实时事件流">
        <List
          size="small"
          dataSource={shown}
          locale={{ emptyText: '等待事件中…' }}
          style={{ maxHeight: '40vh', overflow: 'auto' }}
          renderItem={(f) => (
            <List.Item>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                {new Date(f.ts).toLocaleTimeString()}
              </Typography.Text>
              <Tag>{f.kind}</Tag>
              <Typography.Text code style={{ fontSize: 12 }}>
                {JSON.stringify(f.data)}
              </Typography.Text>
            </List.Item>
          )}
        />
      </Card>

      {/* V1 task 9.2/10.3：按笔记互动历史（risk_interactions 接线后的读侧）。 */}
      <Card size="small" title={`按笔记互动（${interactions.data?.interactions.length ?? 0}）`}>
        <Table
          size="small"
          bordered
          rowKey={(r) => `${r.accountId}:${r.action}:${r.targetId}`}
          loading={interactions.isLoading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={interactionColumns}
          dataSource={interactions.data?.interactions ?? []}
          locale={{ emptyText: '暂无互动记录' }}
        />
      </Card>

      {/* V1 task 9.5/10.3：告警只读流（未解决）。 */}
      <Card size="small" title={`告警（未解决 · ${alerts.data?.alerts.length ?? 0}）`}>
        {alerts.data && alerts.data.alerts.length > 0 ? (
          <List
            size="small"
            dataSource={alerts.data.alerts}
            renderItem={(a) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="resolve"
                    title="标记该告警为已解决？"
                    description="仅从未解决列表移除，不影响账号风控状态或边缘暂停。"
                    okText="解决"
                    cancelText="取消"
                    onConfirm={() => resolveAlert.mutate(a.id)}
                  >
                    <Button
                      type="link"
                      size="small"
                      loading={resolveAlert.isPending && resolveAlert.variables === a.id}
                    >
                      解决
                    </Button>
                  </Popconfirm>,
                ]}
              >
                {/* 单一内容块 + actions：List.Item 用 space-between 布局，内容须包一层才不被 action 拉散、保持左对齐居中。 */}
                <Space size={8} align="center" wrap>
                  <AlertSeverityBadge severity={a.severity} />
                  <Tag style={{ marginInlineEnd: 0 }}>{a.type}</Tag>
                  <Typography.Text>{a.title}</Typography.Text>
                  {a.accountId && (
                    <Typography.Text type="secondary">
                      <ProfileLink userId={a.accountId}>{nameOf(a.accountId)}</ProfileLink>
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary">{new Date(a.createdAt).toLocaleString()}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={alerts.isLoading ? '加载中…' : '暂无未解决告警'} />
        )}
      </Card>

      {/* V1 task 9.6/10.3：真按账号总览切片（归因已流通）。 */}
      <Card size="small" title="今日按账号">
        <AccountTotalsTable rows={summary.data?.totalsByAccount ?? []} accounts={summary.data?.accounts ?? []} loading={summary.isLoading} />
      </Card>
    </div>
  );
}
