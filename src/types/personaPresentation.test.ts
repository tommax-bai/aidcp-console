import { describe, expect, it } from 'vitest';
import type { PanelAccount } from './api';
import { deriveFacebookRuleModePersonaStates } from './personaPresentation';

type PersonaAccount = Pick<PanelAccount, 'accountId' | 'platform' | 'personaBound'>;

const account = (overrides: Partial<PersonaAccount> = {}): PersonaAccount => ({
  accountId: 'fb-1',
  platform: 'facebook',
  personaBound: false,
  ...overrides,
});

const environment = (overrides: Record<string, unknown> = {}) => ({
  envKey: 'facebook-env-1',
  platform: 'facebook',
  lifecycle: { state: 'active' },
  account: { accountId: 'fb-1', platform: 'facebook' },
  executionBinding: { state: 'bound', accountId: 'fb-1' },
  facebookRuleMode: { envKey: 'facebook-env-1', enabled: true },
  ...overrides,
});

function state(
  environments: unknown,
  accountOverrides: Partial<PersonaAccount> = {},
) {
  return deriveFacebookRuleModePersonaStates(
    [account(accountOverrides)],
    environments,
  ).get('fb-1');
}

describe('deriveFacebookRuleModePersonaStates', () => {
  it('enables only the exact active Facebook environment/account/binding/config join', () => {
    expect(state([environment()])).toBe('enabled');
  });

  it.each([
    ['explicitly disabled', [environment({ facebookRuleMode: { envKey: 'facebook-env-1', enabled: false } })]],
    ['no environment', []],
    ['binding conflict', [environment({ executionBinding: { state: 'binding_conflict', accountId: null } })]],
    ['binding mismatch', [environment({ executionBinding: { state: 'bound', accountId: 'fb-2' } })]],
    ['config env mismatch', [environment({ facebookRuleMode: { envKey: 'other-env', enabled: true } })]],
    ['inactive environment', [environment({ lifecycle: { state: 'deleted' } })]],
    ['non-Facebook environment', [environment({ platform: 'wechat_channels' })]],
  ])('returns disabled for %s', (_label, environments) => {
    expect(state(environments)).toBe('disabled');
  });

  it.each([
    ['query unavailable', undefined],
    ['null payload', null],
    ['malformed payload', {}],
    ['missing config', [environment({ facebookRuleMode: undefined })]],
    ['null config', [environment({ facebookRuleMode: null })]],
    ['missing binding', [environment({ executionBinding: undefined })]],
    ['binding unavailable', [environment({ executionBinding: { state: 'binding_unavailable', accountId: null } })]],
    ['malformed enabled', [environment({ facebookRuleMode: { envKey: 'facebook-env-1', enabled: 'yes' } })]],
  ])('returns unknown for %s', (_label, environments) => {
    expect(state(environments)).toBe('unknown');
  });

  it('does not create an exemption for a bound persona or another account platform', () => {
    expect(state([environment()], { personaBound: true })).toBe('disabled');
    expect(state([environment()], { platform: 'xiaohongshu' })).toBe('disabled');
  });

  it('treats multiple apparently enabled bindings as unknown instead of choosing one', () => {
    expect(state([
      environment(),
      environment({ envKey: 'facebook-env-2', facebookRuleMode: { envKey: 'facebook-env-2', enabled: true } }),
    ])).toBe('unknown');
  });
});
