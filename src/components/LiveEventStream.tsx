import { useState } from 'react';
import { Badge, Button, Input, List, Space, Tag, Typography } from 'antd';
import { usePanelWs, type WsStatus } from '../ws/panelWs';

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

/**
 * 实时事件流（merge-monitor-into-dashboard：原「监控」页 PAGE 6 主体，随监控页并入首页搬出）。
 * 面板 WS 单一全局流 + 客户端按类型过滤 + 暂停缓冲。
 * 挂载即建立连接、卸载即断开——由父级「展开才挂载」实现折叠态零连接。
 */
export function LiveEventStream() {
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
    <>
      <Space wrap style={{ marginBottom: 8 }}>
        <Badge status={STATUS_BADGE[status]} text={`连接：${STATUS_LABEL[status]}`} />
        {/* 诚实文案：暂停期间到达的帧被丢弃（panelWs onmessage 直接 return），并无缓冲，绝不暗示可补看。 */}
        <Button size="small" onClick={togglePause}>
          {paused ? '恢复（暂停中新事件已丢弃）' : '暂停'}
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
    </>
  );
}
