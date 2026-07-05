import { describe, expect, it } from 'vitest';
import { formatBillingPriceRefreshMessage } from './tokenUsagePriceRefresh';
import type { LlmBillingPriceRefreshPayload } from '../types/api';

function payload(overrides: Partial<LlmBillingPriceRefreshPayload> = {}): LlmBillingPriceRefreshPayload {
  return {
    ok: true,
    checkedDays: ['2026-07-04', '2026-07-03'],
    targetCount: 2,
    written: 1,
    prices: [
      {
        provider: 'volcengine',
        model: 'doubao-seed-2-0-pro-260215',
        usageDay: '2026-07-04',
        currency: 'CNY',
        pricingBasis: 'input_output_tokens',
        source: 'billing:volcengine:ListBillDetail',
        sourcePeriod: '2026-07-04',
      },
    ],
    skipped: [],
    missingCredentials: [],
    ...overrides,
  };
}

describe('formatBillingPriceRefreshMessage', () => {
  it('formats a successful refresh as success', () => {
    const result = formatBillingPriceRefreshMessage(payload());

    expect(result.level).toBe('success');
    expect(result.text).toContain('厂商模型定价已更新：写入 1 条，检查 2 个模型日');
    expect(result.text).not.toContain('跳过');
  });

  it('summarizes skip reasons and marks zero-write refresh as warning', () => {
    const result = formatBillingPriceRefreshMessage(
      payload({
        targetCount: 3,
        written: 0,
        prices: [],
        skipped: [
          { provider: 'dashscope', model: 'deepseek-v4-flash', usageDay: '2026-07-04', reason: 'no_billing_sample' },
          { provider: 'volcengine', model: 'doubao-seed-character-260628', usageDay: '2026-07-04', reason: 'no_billing_sample' },
          { provider: 'dashscope', model: 'qwen-plus', usageDay: '2026-07-04', reason: 'missing_credentials' },
        ],
        missingCredentials: ['aliyun', 'dashscope'],
      }),
    );

    expect(result.level).toBe('warning');
    expect(result.text).toContain('厂商模型定价未写入：写入 0 条，检查 3 个模型日');
    expect(result.text).toContain('跳过 3 个模型日');
    expect(result.text).toContain('无账单样本 2');
    expect(result.text).toContain('缺少凭据 1');
    expect(result.text).toContain('缺少凭据：阿里云账单凭据');
  });
});
