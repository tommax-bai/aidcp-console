import type { ReplyPolicy } from '../types/interactionReplyConfig';

export type ReplyProcessingMode = 'off' | 'draft' | 'review' | 'auto';

export const REPLY_PROCESSING_MODE_META: Record<ReplyProcessingMode, { label: string; description: string }> = {
  off: {
    label: '不自动处理，仅收取互动',
    description: '继续收取已开启渠道的互动，不生成回复草稿。',
  },
  draft: {
    label: '只生成回复草稿',
    description: '生成后停在草稿，不进入人工或自动发送。',
  },
  review: {
    label: '人工审核后发送',
    description: '生成草稿，人工确认后才尝试发送。',
  },
  auto: {
    label: '低风险模板自动发送',
    description: '只有低风险模板原文可自动发送，其他内容转人工审核。',
  },
};

export const REPLY_PROCESSING_MODES = Object.keys(REPLY_PROCESSING_MODE_META) as ReplyProcessingMode[];

export function replyProcessingModeMetaOf(mode: string): { label: string; description: string } {
  return REPLY_PROCESSING_MODE_META[mode as ReplyProcessingMode] ?? {
    label: mode,
    description: '未知处理方式，请重新选择后保存。',
  };
}

const PRESET: Record<ReplyProcessingMode, Pick<ReplyPolicy, 'mode' | 'generateDrafts' | 'sendReplies'>> = {
  off: { mode: 'draft_only', generateDrafts: false, sendReplies: false },
  draft: { mode: 'draft_only', generateDrafts: true, sendReplies: false },
  review: { mode: 'review_before_send', generateDrafts: true, sendReplies: true },
  auto: { mode: 'auto_safe', generateDrafts: true, sendReplies: true },
};

/**
 * Projects the frozen DTO into one operator-facing intent without expanding legacy write authority.
 * Any disabled generation/send gate wins over a more permissive stored mode.
 */
export function replyProcessingModeOf(
  policy: Pick<ReplyPolicy, 'mode' | 'generateDrafts' | 'sendReplies'>,
): ReplyProcessingMode {
  if (!policy.generateDrafts) return 'off';
  if (!policy.sendReplies || policy.mode === 'draft_only') return 'draft';
  return policy.mode === 'auto_safe' ? 'auto' : 'review';
}

export function applyReplyProcessingMode(policy: ReplyPolicy, mode: ReplyProcessingMode): ReplyPolicy {
  return { ...policy, ...PRESET[mode] };
}

export function isCanonicalReplyProcessingPolicy(
  policy: Pick<ReplyPolicy, 'mode' | 'generateDrafts' | 'sendReplies'>,
): boolean {
  const expected = PRESET[replyProcessingModeOf(policy)];
  return policy.mode === expected.mode
    && policy.generateDrafts === expected.generateDrafts
    && policy.sendReplies === expected.sendReplies;
}
