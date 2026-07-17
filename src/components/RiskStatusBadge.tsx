import { Tag } from 'antd';
import { RISK_STATUS_COLOR, RISK_STATUS_LABEL, labelOf, type RiskStatus } from '../types/aidcp-enums';

/**
 * 风控 STATUS 徽标：filled warm Tag（暖色实底）。
 * 与 QuotaTierBadge 构造级分离（color props 不挂 status 语义 token），绝不合并成一个控件/下拉。
 * 撞名 `正常` 的消歧不再靠 `状态：`/`档位：` 文字前缀（避免换行的表格设计标准），改由
 * warm(实底) vs cool(描边) 色相/形态 + 所在列表头（「风控」vs「档位」）三重区分。
 */
export function RiskStatusBadge({ status }: { status: RiskStatus }) {
  return <Tag color={RISK_STATUS_COLOR[status]}>{labelOf(RISK_STATUS_LABEL, status)}</Tag>;
}
