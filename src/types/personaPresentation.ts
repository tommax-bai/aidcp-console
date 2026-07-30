import type { PanelAccount } from './api';

export type FacebookRuleModePersonaState = 'enabled' | 'disabled' | 'unknown';

type PersonaAccount = Pick<PanelAccount, 'accountId' | 'platform' | 'personaBound'>;
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function classifyEnvironment(
  raw: JsonRecord,
  accountId: string,
): FacebookRuleModePersonaState {
  if (!nonEmptyString(raw.envKey)) return 'unknown';

  if (!isRecord(raw.lifecycle) || !nonEmptyString(raw.lifecycle.state)) return 'unknown';
  if (raw.lifecycle.state !== 'active') {
    return ['waiting_edge', 'deleting', 'delete_failed', 'deleted'].includes(raw.lifecycle.state)
      ? 'disabled'
      : 'unknown';
  }

  if (!nonEmptyString(raw.platform)) return 'unknown';
  if (raw.platform !== 'facebook') return 'disabled';

  if (!isRecord(raw.account) || !nonEmptyString(raw.account.accountId)) return 'unknown';
  if (raw.account.accountId !== accountId) return 'disabled';
  if (!nonEmptyString(raw.account.platform)) return 'unknown';
  if (raw.account.platform !== 'facebook') return 'disabled';

  if (!isRecord(raw.executionBinding) || !nonEmptyString(raw.executionBinding.state)) return 'unknown';
  if (raw.executionBinding.state === 'binding_unavailable') return 'unknown';
  if (raw.executionBinding.state === 'unbound' || raw.executionBinding.state === 'binding_conflict') {
    return 'disabled';
  }
  if (raw.executionBinding.state !== 'bound') return 'unknown';
  if (!nonEmptyString(raw.executionBinding.accountId)) return 'unknown';
  if (raw.executionBinding.accountId !== accountId) return 'disabled';

  if (!isRecord(raw.facebookRuleMode)) return 'unknown';
  if (!nonEmptyString(raw.facebookRuleMode.envKey)) return 'unknown';
  if (raw.facebookRuleMode.envKey !== raw.envKey) return 'disabled';
  if (typeof raw.facebookRuleMode.enabled !== 'boolean') return 'unknown';
  return raw.facebookRuleMode.enabled ? 'enabled' : 'disabled';
}

function stateForAccount(
  account: PersonaAccount,
  environments: unknown,
): FacebookRuleModePersonaState {
  if (!nonEmptyString(account.accountId)) return 'unknown';
  if (!nonEmptyString(account.platform)) return 'unknown';
  if (account.platform !== 'facebook') return 'disabled';
  if (typeof account.personaBound !== 'boolean') return 'unknown';
  if (account.personaBound) return 'disabled';
  if (!Array.isArray(environments)) return 'unknown';

  const matching: JsonRecord[] = [];
  for (const raw of environments) {
    if (!isRecord(raw)) return 'unknown';
    if (raw.account === null) continue;
    if (!isRecord(raw.account) || !nonEmptyString(raw.account.accountId)) return 'unknown';
    if (raw.account.accountId === account.accountId) matching.push(raw);
  }
  if (matching.length === 0) return 'disabled';

  const states = matching.map((environment) => classifyEnvironment(environment, account.accountId));
  if (states.length === 1) return states[0];
  if (states.includes('enabled')) return 'unknown';
  return states.includes('unknown') ? 'unknown' : 'disabled';
}

/**
 * 以账号绑定事实与环境级规则权威做严格 join。
 *
 * `unknown` 是 fail-closed 的事实态：查询不可用、字段缺失或形状不合法时不宣称规则已启用；
 * 呈现层继续遵循账号既有的 `needsPersonaSetup`，只有 `enabled` 可以抑制补人设引导。
 */
export function deriveFacebookRuleModePersonaStates(
  accounts: readonly PersonaAccount[],
  environments: unknown,
): ReadonlyMap<string, FacebookRuleModePersonaState> {
  const states = new Map<string, FacebookRuleModePersonaState>();
  for (const account of accounts) {
    if (!nonEmptyString(account.accountId)) continue;
    states.set(account.accountId, stateForAccount(account, environments));
  }
  return states;
}
