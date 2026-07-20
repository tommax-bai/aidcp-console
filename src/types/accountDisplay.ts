import type { PanelAccount } from './api';

type DisplayAccount = Pick<PanelAccount, 'accountId'> & { displayName?: string | null };

/** Console 不再重建优先级，只消费 Cloud 已解析的 displayName；旧 DTO 唯一兼容回落为 accountId。 */
export function accountDisplayName(account: DisplayAccount): string {
  return account.displayName?.trim() || account.accountId;
}

/** 便捷重载：直接传一行带 nickname/label/accountId 的账号对象。 */
export function accountName(a: DisplayAccount): string {
  return accountDisplayName(a);
}

/**
 * 用账号列表造一个「按 accountId 取展示名」的查值口（console-no-raw-account-ids）。
 * 给只带 accountId 的视图（人设/配额/续场/告警/互动/token 用量）做客户端 join：
 * 命中账号 → 走诚实回落链；未命中（理论上不达，FK 保证）→ 回落裸 accountId（绝不崩、绝不伪造）。
 * 所有「只有 accountId 的地方显示账号名」统一走它，禁止各处内联手写回落链（防漂移）。
 */
export function makeAccountNamer(
  accounts: ReadonlyArray<DisplayAccount>,
): (accountId: string) => string {
  const byId = new Map(accounts.map((a) => [a.accountId, a]));
  return (accountId: string): string => {
    const a = byId.get(accountId);
    return a ? accountDisplayName(a) : accountId;
  };
}
