import { describe, expect, it } from 'vitest';
import type { ReplyPolicy } from '../types/interactionReplyConfig';
import {
  applyReplyProcessingMode,
  isCanonicalReplyProcessingPolicy,
  replyProcessingModeOf,
} from './wechatChannelsReplyMode';

const basePolicy: ReplyPolicy = {
  mode: 'draft_only',
  generateDrafts: false,
  sendReplies: false,
  channels: {
    comment: { enabled: true, aiPolishEnabled: false, allowAutoSend: false },
    dm: { enabled: true, aiPolishEnabled: false, allowAutoSend: false },
  },
  rateLimits: {
    accountPerMinute: 1,
    accountPerHour: 10,
    accountPerDay: 20,
    threadCooldownSeconds: 60,
    newLoginCooldownSeconds: 600,
    consecutiveFailureLimit: 3,
  },
};

describe('wechatChannelsReplyMode', () => {
  it.each([
    ['off', 'draft_only', false, false],
    ['draft', 'draft_only', true, false],
    ['review', 'review_before_send', true, true],
    ['auto', 'auto_safe', true, true],
  ] as const)('maps %s to one canonical frozen DTO combination', (mode, wireMode, generateDrafts, sendReplies) => {
    const policy = applyReplyProcessingMode(basePolicy, mode);
    expect(policy).toMatchObject({ mode: wireMode, generateDrafts, sendReplies });
    expect(replyProcessingModeOf(policy)).toBe(mode);
    expect(isCanonicalReplyProcessingPolicy(policy)).toBe(true);
  });

  it.each([
    [{ mode: 'auto_safe', generateDrafts: false, sendReplies: true }, 'off'],
    [{ mode: 'review_before_send', generateDrafts: true, sendReplies: false }, 'draft'],
    [{ mode: 'draft_only', generateDrafts: true, sendReplies: true }, 'draft'],
    [{ mode: 'auto_safe', generateDrafts: true, sendReplies: true }, 'auto'],
  ] as const)('projects legacy combination %o without expanding authority', (policy, expected) => {
    expect(replyProcessingModeOf(policy)).toBe(expected);
    expect(isCanonicalReplyProcessingPolicy(policy)).toBe(
      policy.mode === 'auto_safe' && policy.generateDrafts && policy.sendReplies,
    );
  });
});
