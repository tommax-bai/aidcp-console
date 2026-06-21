import { Tag, Tooltip } from 'antd';
import { ALERT_SEVERITY_COLOR, ALERT_SEVERITY_LABEL, type AlertSeverity } from '../types/aidcp-enums';

/** 告警分级徽标（V1 task 9.5；P0/P1 红橙抢眼、P3 中性灰不抢视觉）。代号保留 + 中文释义 tooltip。 */
export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <Tooltip title={`${severity} ${ALERT_SEVERITY_LABEL[severity]}`}>
      <Tag color={ALERT_SEVERITY_COLOR[severity]}>{severity}</Tag>
    </Tooltip>
  );
}
