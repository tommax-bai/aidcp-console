import type { RateLimits } from '../types/interactionReplyConfig';

export type WechatChannelsRateLimitPreset = 'conservative' | 'standard' | 'custom';

export const WECHAT_CHANNELS_RATE_LIMIT_PRESETS = {
  conservative: {
    accountPerMinute: 2,
    accountPerHour: 20,
    accountPerDay: 100,
    threadCooldownSeconds: 60,
    newLoginCooldownSeconds: 600,
    consecutiveFailureLimit: 3,
  },
  standard: {
    accountPerMinute: 4,
    accountPerHour: 60,
    accountPerDay: 300,
    threadCooldownSeconds: 30,
    newLoginCooldownSeconds: 300,
    consecutiveFailureLimit: 3,
  },
} as const satisfies Record<Exclude<WechatChannelsRateLimitPreset, 'custom'>, RateLimits>;

const RATE_LIMIT_KEYS = Object.keys(
  WECHAT_CHANNELS_RATE_LIMIT_PRESETS.conservative,
) as Array<keyof RateLimits>;

function matchesPreset(limits: RateLimits, preset: RateLimits): boolean {
  return RATE_LIMIT_KEYS.every((key) => limits[key] === preset[key]);
}

export function wechatChannelsRateLimitPresetOf(limits: RateLimits): WechatChannelsRateLimitPreset {
  if (matchesPreset(limits, WECHAT_CHANNELS_RATE_LIMIT_PRESETS.conservative)) return 'conservative';
  if (matchesPreset(limits, WECHAT_CHANNELS_RATE_LIMIT_PRESETS.standard)) return 'standard';
  return 'custom';
}

export function applyWechatChannelsRateLimitPreset(
  limits: RateLimits,
  preset: WechatChannelsRateLimitPreset,
): RateLimits {
  if (preset === 'custom') return { ...limits };
  return { ...WECHAT_CHANNELS_RATE_LIMIT_PRESETS[preset] };
}

export function summarizeWechatChannelsRateLimits(limits: RateLimits): string {
  return `每分钟 ${limits.accountPerMinute} 条、每小时 ${limits.accountPerHour} 条、每天 ${limits.accountPerDay} 条；同会话间隔 ${limits.threadCooldownSeconds} 秒`;
}
