import { useState } from 'react';
import { Badge, Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { usePanelWs, type WsStatus } from '../ws/panelWs';

const STATUS_BADGE: Record<WsStatus, 'processing' | 'success' | 'warning' | 'default'> = {
  connecting: 'processing',
  live: 'success',
  reconnecting: 'warning',
  offline: 'default',
};

/** 运行监控（design PAGE 6）：面板 WS 单一全局流 + 客户端过滤；暂停滚动；断连诚实。 */
export function MonitorPage() {
  const { frames, status, setPaused } = usePanelWs();
  const [paused, setPausedState] = useState(false);
  const [filter, setFilter] = useState('');

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
          style={{ maxHeight: '60vh', overflow: 'auto' }}
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
    </div>
  );
}
