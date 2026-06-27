import type { PanelAccount } from './api';

/**
 * 账号展示名诚实回落链（change account-real-nickname）：真名 → 运营名 → 账号ID。
 * 用空白裁剪 + `||` 兜底：读不到真名回落运营标识/ID，绝不显示空白或假名（守「不伪造」红线）。
 * 所有「显示账号名」处统一走它，防各处回落链漂移。
 */
export function accountDisplayName(
  nickname: string | null | undefined,
  label: string | null | undefined,
  accountId: string,
): string {
  const nn = nickname?.trim();
  const lb = label?.trim();
  return nn || lb || accountId;
}

/** 便捷重载：直接传一行带 nickname/label/accountId 的账号对象。 */
export function accountName(a: Pick<PanelAccount, 'nickname' | 'label' | 'accountId'>): string {
  return accountDisplayName(a.nickname, a.label, a.accountId);
}

/**
 * 用账号列表造一个「按 accountId 取展示名」的查值口（console-no-raw-account-ids）。
 * 给只带 accountId 的视图（人设/配额/续场/告警/互动/token 用量）做客户端 join：
 * 命中账号 → 走诚实回落链；未命中（理论上不达，FK 保证）→ 回落裸 accountId（绝不崩、绝不伪造）。
 * 所有「只有 accountId 的地方显示账号名」统一走它，禁止各处内联手写回落链（防漂移）。
 */
export function makeAccountNamer(
  accounts: ReadonlyArray<Pick<PanelAccount, 'accountId' | 'nickname' | 'label'>>,
): (accountId: string) => string {
  const byId = new Map(accounts.map((a) => [a.accountId, a]));
  return (accountId: string): string => {
    const a = byId.get(accountId);
    return a ? accountDisplayName(a.nickname, a.label, accountId) : accountId;
  };
}
