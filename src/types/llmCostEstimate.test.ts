import { describe, expect, it } from 'vitest';
import { estimateLlmUsageCost, formatEstimatedCostCny, priceForModel } from './llmCostEstimate';

describe('llmCostEstimate', () => {
  it('estimates qwen3.7-plus with input and output prices', () => {
    const estimate = estimateLlmUsageCost({
      model: 'qwen3.7-plus',
      promptTokens: 100_000,
      completionTokens: 20_000,
    });

    expect(estimate?.costCny).toBeCloseTo(0.432);
    expect(formatEstimatedCostCny(estimate!.costCny)).toBe('~¥0.4320');
  });

  it('matches versioned and provider-style model names conservatively', () => {
    expect(priceForModel('qwen-plus-2025-07-14')?.inputCnyPerMillion).toBe(0.8);
    expect(priceForModel('doubao-seed-1-6-250615')?.outputCnyPerMillion).toBe(8);
    expect(priceForModel('doubao-seed-1.6-flash')?.inputCnyPerMillion).toBe(0.15);
  });

  it('does not fabricate an estimate for unknown models', () => {
    expect(estimateLlmUsageCost({ model: 'custom-model', promptTokens: 10_000, completionTokens: 2_000 })).toBeNull();
  });
});
