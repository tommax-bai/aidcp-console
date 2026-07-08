import { Tag } from 'antd';
import { RISK_QUOTA_COLOR, RISK_QUOTA_LABEL, type RiskQuotaLevel } from '../types/aidcp-enums';

/**
 * 风控 QUOTA-TIER 徽标：outlined cool Tag（冷色描边）。
 * 与 RiskStatusBadge 是两个独立徽标——撞名 `正常` 的消歧不再靠 `档位：`/`状态：` 文字前缀
 *（避免换行的表格设计标准），改由 cool(描边) vs warm(实底) 色相/形态 + 所在列表头
 *（「档位」vs「风控」）三重区分。
 */
export function QuotaTierBadge({ tier }: { tier: RiskQuotaLevel }) {
  return (
    <Tag bordered color={RISK_QUOTA_COLOR[tier]}>
      {RISK_QUOTA_LABEL[tier]}
    </Tag>
  );
}
