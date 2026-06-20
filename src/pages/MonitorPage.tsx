import { useState } from 'react';
import { Badge, Button, Card, Empty, Input, List, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { usePanelWs, type WsStatus } from '../ws/panelWs';
import { useAlerts, useInteractions, useDashboardSummary } from '../api/queries';
import { AccountTotalsTable, AlertSeverityBadge } from '../components';
import type { PanelInteraction } from '../types/api';

const STATUS_BADGE: Record<WsStatus, 'processing' | 'success' | 'warning' | 'default'> = {
  connecting: 'processing',
  live: 'success',
  reconnecting: 'warning',
  offline: 'default',
};

const interactionColumns: ColumnsType<PanelInteraction> = [
  {
    title: 'When',
    dataIndex: 'interactedAt',
    key: 'when',
    render: (v: number) => new Date(v).toLocaleString(),
  },
  { title: 'Account', dataIndex: 'accountId', key: 'accountId' },
  { title: 'Action', dataIndex: 'action', key: 'action', render: (v: string) => <Tag>{v}</Tag> },
  { title: 'Note', dataIndex: 'noteId', key: 'noteId', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
];

/** 运行监控（design PAGE 6）：面板 WS 单一全局流 + 按笔记互动 + 告警只读流 + 真按账号总览（V1 task 10.3）。 */
export function MonitorPage() {
  const { frames, status, setPaused } = usePanelWs();
  const [paused, setPausedState] = useState(false);
  const [filter, setFilter] = useState('');

  const interactions = useInteractions();
  const alerts = useAlerts();
  const summary = useDashboardSummary();

  const togglePause = () => {
    const next = !paused;
    setPausedState(next);
    setPaused(next);
  };

  const shown = filter ? frames.filter((f) => f.kind.includes(filter)) : frames;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <Space wrap>
          <Badge status={STATUS_BADGE[status]} text={`WS: ${status}`} />
          <Button size="small" onClick={togglePause}>
            {paused ? `resume (${frames.length} buffered)` : 'pause'}
          </Button>
          <Input
            size="small"
            placeholder="filter by kind"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Typography.Text type="secondary">
            {shown.length} events（max 500，单一全局流 · 断连不回填）
          </Typography.Text>
        </Space>
      </Card>

      <Card size="small" title="Live event stream">
        <List
          size="small"
          dataSource={shown}
          locale={{ emptyText: 'waiting for events…' }}
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
      <Card size="small" title={`Interactions by note (${interactions.data?.interactions.length ?? 0})`}>
        <Table
          size="small"
          bordered
          rowKey={(r) => `${r.accountId}:${r.noteId}:${r.action}`}
          loading={interactions.isLoading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={interactionColumns}
          dataSource={interactions.data?.interactions ?? []}
          locale={{ emptyText: 'no recorded interactions yet' }}
        />
      </Card>

      {/* V1 task 9.5/10.3：告警只读流（未解决）。 */}
      <Card size="small" title={`Alerts (unresolved · ${alerts.data?.alerts.length ?? 0})`}>
        {alerts.data && alerts.data.alerts.length > 0 ? (
          <List
            size="small"
            dataSource={alerts.data.alerts}
            renderItem={(a) => (
              <List.Item>
                <AlertSeverityBadge severity={a.severity} />
                <Tag>{a.type}</Tag>
                <Typography.Text style={{ marginRight: 8 }}>{a.title}</Typography.Text>
                {a.accountId && (
                  <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                    {a.accountId}
                  </Typography.Text>
                )}
                <Typography.Text type="secondary">{new Date(a.createdAt).toLocaleString()}</Typography.Text>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={alerts.isLoading ? 'loading…' : 'no unresolved alerts'} />
        )}
      </Card>

      {/* V1 task 9.6/10.3：真按账号总览切片（归因已流通）。 */}
      <Card size="small" title="Today by account">
        <AccountTotalsTable rows={summary.data?.totalsByAccount ?? []} loading={summary.isLoading} />
      </Card>
    </div>
  );
}
