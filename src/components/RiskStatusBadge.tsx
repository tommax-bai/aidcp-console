import { Tag } from 'antd';
import { RISK_STATUS_COLOR, type RiskStatus } from '../types/aidcp-enums';

/**
 * 风控 STATUS 徽标：filled warm Tag + `Status:` 前缀。
 * 与 QuotaTierBadge 构造级分离（color props 不挂 status 语义 token），绝不合并成一个控件/下拉。
 */
export function RiskStatusBadge({ status }: { status: RiskStatus }) {
  return <Tag color={RISK_STATUS_COLOR[status]}>Status: {status}</Tag>;
}
