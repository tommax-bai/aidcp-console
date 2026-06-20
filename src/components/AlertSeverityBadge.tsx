import { Tag } from 'antd';
import { ALERT_SEVERITY_COLOR, type AlertSeverity } from '../types/aidcp-enums';

/** 告警分级徽标（V1 task 9.5；P0/P1 红橙抢眼、P3 中性灰不抢视觉）。 */
export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <Tag color={ALERT_SEVERITY_COLOR[severity]}>{severity}</Tag>;
}
