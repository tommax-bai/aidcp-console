import type { LlmBillingPriceRefreshPayload } from '../types/api';

type RefreshSkipReason = LlmBillingPriceRefreshPayload['skipped'][number]['reason'];

export interface BillingPriceRefreshMessage {
  level: 'success' | 'warning';
  text: string;
}

const billingCredentialLabel: Record<string, string> = {
  aliyun: '阿里云账单凭据',
  dashscope: '阿里云账单凭据',
  volcengine: '火山账单凭据',
};

const skipReasonLabel: Record<RefreshSkipReason, string> = {
  missing_credentials: '缺少凭据',
  unsupported_provider: '暂不支持厂商',
  no_local_usage: '无本地用量',
  no_billing_sample: '无账单样本',
  billing_api_error: '账单接口错误',
};

export function formatBillingPriceRefreshMessage(result: LlmBillingPriceRefreshPayload): BillingPriceRefreshMessage {
  const missingLabels = Array.from(new Set(result.missingCredentials.map((key) => billingCredentialLabel[key] ?? key)));
  const missing = missingLabels.length ? `；缺少凭据：${missingLabels.join('、')}` : '';
  const skipReasons = summarizeSkipReasons(result.skipped.map((s) => s.reason));
  const skipped = result.skipped.length
    ? `；跳过 ${result.skipped.length} 个模型日${skipReasons ? `（${skipReasons}）` : ''}`
    : '';
  const level = result.written === 0 && result.skipped.length > 0 ? 'warning' : 'success';
  const title = level === 'warning' ? '厂商模型定价未写入' : '厂商模型定价已更新';
  return {
    level,
    text: `${title}：写入 ${result.written} 条，检查 ${result.targetCount} 个模型日${skipped}${missing}`,
  };
}

function summarizeSkipReasons(reasons: RefreshSkipReason[]): string {
  const counts = new Map<RefreshSkipReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort(([a], [b]) => skipReasonLabel[a].localeCompare(skipReasonLabel[b], 'zh-CN'))
    .map(([reason, count]) => `${skipReasonLabel[reason]} ${count}`)
    .join('、');
}
