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
