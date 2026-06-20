import { describe, it, expect } from 'vitest';
import { RISK_STATUSES, RISK_QUOTA_LEVELS, RISK_ACTIONS } from './aidcp-enums';
import type { VersionPayload } from './api';

describe('aidcp-enums 镜像（D11 漂移哨兵）', () => {
  it('镜像枚举值固定（手滑改错即失败）', () => {
    expect([...RISK_STATUSES]).toEqual(['normal', 'warned', 'restricted', 'frozen']);
    expect([...RISK_QUOTA_LEVELS]).toEqual(['conservative', 'normal', 'aggressive']);
    expect([...RISK_ACTIONS]).toEqual(['like', 'collect', 'comment', 'follow', 'publish', 'view']);
  });

  // 对 live cloud /api/version 断言（设 AIDCP_PANEL_URL 启用，否则跳过）。
  const liveUrl = process.env.AIDCP_PANEL_URL;
  it.skipIf(!liveUrl)('与 live cloud /api/version 一致', async () => {
    const res = await fetch(`${liveUrl}/api/version`);
    const body = (await res.json()) as VersionPayload;
    expect(body.enums.riskStatus).toEqual([...RISK_STATUSES]);
    expect(body.enums.riskQuotaLevel).toEqual([...RISK_QUOTA_LEVELS]);
    expect(body.enums.riskAction).toEqual([...RISK_ACTIONS]);
  });
});
