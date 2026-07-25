import { apiGet } from './client';

/**
 * 风控写命令的结果回读（cloud change cloud-coupling-phase5 · P5-1）。
 *
 * 风控写在云端已改成异步：后台提交只拿到一个 commandId，真正的写发生在自动化侧的单写者身上。
 * 因此这里 MUST 轮询回读，且四态 MUST 分开渲染——尤其：
 *   - `processing` 要显式告诉操作员「还在处理」，绝不能因为提交成功就显示「已生效」；
 *   - `failed` 要把原因显示出来；
 *   - `unknown`（查无此命令）**不是** processing。把它当处理中，界面会永远转圈且永不报错。
 * 轮询超时同样 MUST NOT 报成功，只能如实说「仍在处理中」。
 */
export type RiskCommandOutcome =
  | { commandId: string; state: 'processing' }
  | { commandId: string; state: 'applied'; decidedAt: number; status: string; quotaLevel: string }
  | { commandId: string; state: 'failed'; decidedAt: number; reason: string }
  | { commandId: string; state: 'unknown' };

/** 提交回执。云端刻意不带任何写后状态字段——受理那一刻结果还不存在。 */
export interface RiskCommandAccepted {
  accepted: true;
  commandId: string;
}

export function fetchRiskCommandOutcome(commandId: string): Promise<RiskCommandOutcome> {
  return apiGet<RiskCommandOutcome>(`/api/risk-commands/${encodeURIComponent(commandId)}`);
}

/** 轮询上限：单写者正常是毫秒级唤醒；给到 ~8 秒足够覆盖一次队列排队，超过就如实说仍在处理。 */
const POLL_INTERVAL_MS = 400;
const POLL_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询到终态（applied / failed / unknown）为止；超时则返回最后一次的 `processing`。
 * **绝不把超时当成功**：调用方据 state 渲染，超时那条走的是「仍在处理中」的文案。
 */
export async function awaitRiskCommand(commandId: string): Promise<RiskCommandOutcome> {
  let last: RiskCommandOutcome = { commandId, state: 'processing' };
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    // 首轮也先等一小会：单写者是异步的，立刻问几乎必然是 processing，白打一次往返。
    await sleep(POLL_INTERVAL_MS);
    last = await fetchRiskCommandOutcome(commandId);
    if (last.state !== 'processing') return last;
  }
  return last;
}
