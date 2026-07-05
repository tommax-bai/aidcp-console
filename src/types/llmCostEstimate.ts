import type { LlmUsageRow } from './api';

export interface LlmTokenPrice {
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
  label: string;
  note: string;
}

export interface LlmCostEstimate {
  costCny: number;
  price: LlmTokenPrice;
}

type PriceRule = {
  test: RegExp;
  price: LlmTokenPrice;
};

export const COST_ESTIMATE_TOOLTIP =
  '按公开刊例价粗估；未扣免费额度、缓存、Batch、资源包、合同折扣或区域价差。未知模型不估算。';

const PRICE_RULES: PriceRule[] = [
  {
    test: /^qwen3[.-]7-max(?:-|$)/,
    price: {
      inputCnyPerMillion: 14.4,
      outputCnyPerMillion: 43.2,
      label: '阿里百炼 qwen3.7-max',
      note: '中国内地公开价，0-1M 输入档',
    },
  },
  {
    test: /^qwen3[.-]7-plus(?:-|$)/,
    price: {
      inputCnyPerMillion: 2.4,
      outputCnyPerMillion: 9.6,
      label: '阿里百炼 qwen3.7-plus',
      note: '中国内地公开价，0-256K 输入档',
    },
  },
  {
    test: /^qwen3[.-]6-plus(?:-|$)/,
    price: {
      inputCnyPerMillion: 2.4,
      outputCnyPerMillion: 14.4,
      label: '阿里百炼 qwen3.6-plus',
      note: '中国内地公开价，0-256K 输入档',
    },
  },
  {
    test: /^qwen3[.-]5-plus(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.96,
      outputCnyPerMillion: 5.76,
      label: '阿里百炼 qwen3.5-plus',
      note: '中国内地公开价，0-128K 输入档',
    },
  },
  {
    test: /^qwen-plus(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.8,
      outputCnyPerMillion: 2,
      label: '阿里百炼 qwen-plus',
      note: '中国内地公开价，0-128K 输入档，按非思考输出估算',
    },
  },
  {
    test: /^qwen-max(?:-|$)/,
    price: {
      inputCnyPerMillion: 2.4,
      outputCnyPerMillion: 9.6,
      label: '阿里百炼 qwen-max',
      note: '中国内地公开价，无阶梯',
    },
  },
  {
    test: /^qwen-turbo(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.3,
      outputCnyPerMillion: 0.6,
      label: '阿里百炼 qwen-turbo',
      note: '中国内地公开价，按非思考输出估算',
    },
  },
  {
    test: /^qwen-long(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.5,
      outputCnyPerMillion: 2,
      label: '阿里百炼 qwen-long',
      note: '中国内地公开价',
    },
  },
  {
    test: /^doubao-seed-1[.-]6-flash(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.15,
      outputCnyPerMillion: 1.5,
      label: '火山方舟 doubao-seed-1.6-flash',
      note: '公开价，0-32K 输入档',
    },
  },
  {
    test: /^doubao-seed-1[.-]6-lite(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.3,
      outputCnyPerMillion: 2.4,
      label: '火山方舟 doubao-seed-1.6-lite',
      note: '公开价，0-32K 输入档，按输出超过 200 token 档估算',
    },
  },
  {
    test: /^doubao-seed-1[.-]6(?:-|$)/,
    price: {
      inputCnyPerMillion: 0.8,
      outputCnyPerMillion: 8,
      label: '火山方舟 doubao-seed-1.6',
      note: '公开价，0-32K 输入档，按输出超过 200 token 档估算',
    },
  },
];

export function priceForModel(model: string): LlmTokenPrice | null {
  const normalized = model.trim().toLowerCase();
  const rule = PRICE_RULES.find((r) => r.test.test(normalized));
  return rule?.price ?? null;
}

export function estimateLlmUsageCost(
  row: Pick<LlmUsageRow, 'model' | 'promptTokens' | 'completionTokens'>,
): LlmCostEstimate | null {
  const price = priceForModel(row.model);
  if (!price) return null;

  const promptTokens = Math.max(0, row.promptTokens);
  const completionTokens = Math.max(0, row.completionTokens);
  const costCny =
    (promptTokens * price.inputCnyPerMillion + completionTokens * price.outputCnyPerMillion) / 1_000_000;

  return { costCny, price };
}

export function formatEstimatedCostCny(costCny: number): string {
  if (!Number.isFinite(costCny) || costCny <= 0) return '¥0';
  if (costCny < 0.0001) return '<¥0.0001';
  if (costCny < 1) return `~¥${costCny.toFixed(4)}`;
  return `~¥${costCny.toFixed(2)}`;
}
