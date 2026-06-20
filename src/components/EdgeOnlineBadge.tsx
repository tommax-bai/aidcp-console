import { Badge, Tooltip } from 'antd';
import { EDGE_ONLINE_BADGE, type EdgeOnlineState } from '../types/aidcp-enums';

const TOOLTIP: Record<EdgeOnlineState, string> = {
  online: 'online: in-map and recent heartbeat',
  stale: 'stale: in-map but no recent heartbeat',
  offline: 'offline: not connected',
};

/**
 * edge online 三态（online / stale / offline，绝不二元）：永远配文字 + tooltip。
 * stale = 还在连接 Map 里但无近心跳，不得显示为 online（design §2.4 / cloud D9）。
 */
export function EdgeOnlineBadge({ state }: { state: EdgeOnlineState }) {
  return (
    <Tooltip title={TOOLTIP[state]}>
      <Badge status={EDGE_ONLINE_BADGE[state]} text={state} />
    </Tooltip>
  );
}
