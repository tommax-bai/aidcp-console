import { describe, it, expect } from 'vitest';
import {
  RISK_STATUSES,
  RISK_QUOTA_LEVELS,
  RISK_ACTIONS,
  ALERT_SEVERITIES,
  RISK_ACTION_LABEL,
  RISK_ACTION_COLOR,
  LLM_KINDS,
  MODEL_EFFECTIVE_SOURCES,
  PERSONA_SOURCES,
  THINKING_MODES_API,
} from './aidcp-enums';
import type { VersionPayload } from './api';

describe('aidcp-enums 镜像（D11 漂移哨兵）', () => {
  it('镜像枚举值 = cloud /api/version 真值快照（cloud 改枚举须同步此处 + aidcp-enums.ts）', () => {
    // ⚠️ 此为 cloud src/panel/version.ts 真值快照。无 live cloud 的 CI 下，本断言 + 下方结构自洽断言
    // 防「改镜像忘改期望」；cloud 真正漂移由下方 live 对拍（AIDCP_PANEL_URL）检出。
    expect([...RISK_STATUSES]).toEqual(['normal', 'warned', 'restricted', 'frozen']);
    expect([...RISK_QUOTA_LEVELS]).toEqual(['conservative', 'normal', 'aggressive']);
    expect([...RISK_ACTIONS]).toEqual(['like', 'collect', 'comment', 'follow', 'publish', 'view', 'search', 'comment_like', 'join_group', 'dm_reply']);
    expect([...ALERT_SEVERITIES]).toEqual(['P0', 'P1', 'P2', 'P3']);
    // 面板角色/模型配置枚举镜像（change console-panel-config-enum-fingerprint）。
    expect([...LLM_KINDS]).toEqual(['text', 'image', 'vision', 'none']);
    expect([...MODEL_EFFECTIVE_SOURCES]).toEqual(['override', 'category', 'default', 'image', 'vision']);
    expect([...PERSONA_SOURCES]).toEqual(['override', 'none']);
    expect([...THINKING_MODES_API]).toEqual(['default', 'off', 'on']);
  });

  it('每个风控动作都配了 label 与 color（结构自洽：加动作忘配即失败）', () => {
    for (const action of RISK_ACTIONS) {
      expect(RISK_ACTION_LABEL[action], `动作 ${action} 缺中文 label`).toBeTruthy();
      expect(RISK_ACTION_COLOR[action], `动作 ${action} 缺徽标色`).toBeTruthy();
    }
    // 反向：label/color 的键不多于动作集（防遗留死键）
    expect(Object.keys(RISK_ACTION_LABEL).sort()).toEqual([...RISK_ACTIONS].sort());
    expect(Object.keys(RISK_ACTION_COLOR).sort()).toEqual([...RISK_ACTIONS].sort());
  });

  // 对 live cloud /api/version 断言（设 AIDCP_PANEL_URL 启用，否则跳过）——检出 cloud 真正漂移的唯一手段。
  const liveUrl = process.env.AIDCP_PANEL_URL;
  it.skipIf(!liveUrl)('与 live cloud /api/version 一致（枚举全集 + 图片厂商 + DTO 字段指纹）', async () => {
    const res = await fetch(`${liveUrl}/api/version`);
    const body = (await res.json()) as VersionPayload;
    expect(body.enums.riskStatus).toEqual([...RISK_STATUSES]);
    expect(body.enums.riskQuotaLevel).toEqual([...RISK_QUOTA_LEVELS]);
    expect(body.enums.riskAction).toEqual([...RISK_ACTIONS]);
    expect(body.enums.alertSeverity).toEqual([...ALERT_SEVERITIES]);
    // #5/#6：图片厂商全集 + DTO 字段指纹对拍（console 镜像须与 cloud live 一致）。
    expect(body.enums.imageProvider).toContain('volcengine');
    expect(body.dtoFields.panelAccount).toContain('accountId');
    // 配置枚举哨兵（change console-panel-config-enum-fingerprint）：镜像须与 cloud live 全集一致。
    expect(body.enums.llmKind).toEqual([...LLM_KINDS]);
    expect(body.enums.effectiveSource).toEqual([...MODEL_EFFECTIVE_SOURCES]);
    expect(body.enums.personaSource).toEqual([...PERSONA_SOURCES]);
    expect(body.enums.thinkingMode).toEqual([...THINKING_MODES_API]);
  });
});
