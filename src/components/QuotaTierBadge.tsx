import { Tag } from 'antd';
import { RISK_QUOTA_COLOR, type RiskQuotaLevel } from '../types/aidcp-enums';

/**
 * 风控 QUOTA-TIER 徽标：outlined cool Tag + `Tier:` 前缀。
 * 与 RiskStatusBadge 是两个独立徽标——撞名 `normal` 靠 warm/cool 色相 + filled/outlined 形态 + 前缀三重分离。
 */
export function QuotaTierBadge({ tier }: { tier: RiskQuotaLevel }) {
  return (
    <Tag bordered color={RISK_QUOTA_COLOR[tier]}>
      Tier: {tier}
    </Tag>
  );
}
