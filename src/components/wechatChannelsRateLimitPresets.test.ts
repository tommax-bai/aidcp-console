import { describe, expect, it } from 'vitest';
import type { RateLimits } from '../types/interactionReplyConfig';
import {
  applyWechatChannelsRateLimitPreset,
  summarizeWechatChannelsRateLimits,
  WECHAT_CHANNELS_RATE_LIMIT_PRESETS,
  wechatChannelsRateLimitPresetOf,
} from './wechatChannelsRateLimitPresets';

describe('wechatChannelsRateLimitPresets', () => {
  it('matches conservative and standard only when every stored value is exact', () => {
    expect(wechatChannelsRateLimitPresetOf({ ...WECHAT_CHANNELS_RATE_LIMIT_PRESETS.conservative })).toBe('conservative');
    expect(wechatChannelsRateLimitPresetOf({ ...WECHAT_CHANNELS_RATE_LIMIT_PRESETS.standard })).toBe('standard');
    expect(wechatChannelsRateLimitPresetOf({
      ...WECHAT_CHANNELS_RATE_LIMIT_PRESETS.standard,
      newLoginCooldownSeconds: 301,
    })).toBe('custom');
  });

  it('keeps historical zero limits custom and never rewrites them when custom is selected', () => {
    const historical: RateLimits = {
      accountPerMinute: 0,
      accountPerHour: 0,
      accountPerDay: 0,
      threadCooldownSeconds: 60,
      newLoginCooldownSeconds: 600,
      consecutiveFailureLimit: 3,
    };
    const projected = applyWechatChannelsRateLimitPreset(historical, 'custom');
    expect(wechatChannelsRateLimitPresetOf(projected)).toBe('custom');
    expect(projected).toEqual(historical);
    expect(projected).not.toBe(historical);
  });

  it('deliberately replaces the complete limit object for a named preset', () => {
    const original = { ...WECHAT_CHANNELS_RATE_LIMIT_PRESETS.conservative };
    const standard = applyWechatChannelsRateLimitPreset(original, 'standard');
    expect(standard).toEqual(WECHAT_CHANNELS_RATE_LIMIT_PRESETS.standard);
    expect(original).toEqual(WECHAT_CHANNELS_RATE_LIMIT_PRESETS.conservative);
    expect(summarizeWechatChannelsRateLimits(standard)).toContain('每天 300 条');
  });
});
