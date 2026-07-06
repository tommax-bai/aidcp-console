import { describe, expect, it } from 'vitest';
import { promptPersonaSourceSummary } from './rolePromptPersonaSource';

describe('promptPersonaSourceSummary', () => {
  it('marks no-account preview as sample persona', () => {
    const summary = promptPersonaSourceSummary({ personaSource: 'sample', personaSourceLabel: '示例人设' });

    expect(summary.label).toBe('示例人设');
    expect(summary.alertType).toBe('info');
    expect(summary.description).toContain('未选择账号');
  });

  it('marks selected bound account as account persona', () => {
    const summary = promptPersonaSourceSummary(
      { accountId: 'acc-1', personaSource: 'account', personaSourceLabel: '所选账号人设' },
      () => '运营账号A',
    );

    expect(summary.label).toBe('所选账号人设');
    expect(summary.alertType).toBe('info');
    expect(summary.description).toContain('运营账号A');
    expect(summary.description).toContain('真实人设');
  });

  it('marks unbound selected account as warning fallback sample', () => {
    const summary = promptPersonaSourceSummary(
      { accountId: 'acc-2', personaFallback: true, personaSource: 'fallback_sample' },
      () => '未绑账号',
    );

    expect(summary.label).toBe('示例人设');
    expect(summary.alertType).toBe('warning');
    expect(summary.description).toContain('未绑定人设');
    expect(summary.description).toContain('运行会被拒绝');
  });
});
