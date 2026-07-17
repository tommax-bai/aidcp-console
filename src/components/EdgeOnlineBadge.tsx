import { Badge, Tooltip } from 'antd';
import { EDGE_ONLINE_BADGE, EDGE_ONLINE_LABEL, labelOf, type EdgeOnlineState } from '../types/aidcp-enums';

const TOOLTIP: Record<EdgeOnlineState, string> = {
  online: '在线：在连接表中且近期有心跳',
  stale: '失联：在连接表中但近期无心跳',
  offline: '离线：未连接',
};

/**
 * edge online 三态（在线 / 失联 / 离线，绝不二元）：永远配文字 + tooltip。
 * 失联 = 还在连接 Map 里但无近心跳，不得显示为在线（design §2.4 / cloud D9）。
 */
export function EdgeOnlineBadge({ state }: { state: EdgeOnlineState }) {
  return (
    <Tooltip title={TOOLTIP[state]}>
      <Badge status={EDGE_ONLINE_BADGE[state]} text={labelOf(EDGE_ONLINE_LABEL, state)} />
    </Tooltip>
  );
}
