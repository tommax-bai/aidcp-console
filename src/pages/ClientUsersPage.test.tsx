import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { statusTag, sourceTag, platformTag } from './ClientUsersPage';

/**
 * 只锁「枚举漂移不白屏」这一关键不变量（memory: console↔cloud 枚举漂移会 white-screen）：
 * 已知联合渲成中文标签、未知值回落灰底裸值而非 crash。纯渲染、无 portal，不 flaky。
 */
describe('ClientUsersPage display helpers — enum drift fallback', () => {
  it('renders known status/source in Chinese', () => {
    expect(render(statusTag('enabled')).container.textContent).toContain('启用');
    expect(render(statusTag('disabled')).container.textContent).toContain('停用');
    expect(render(sourceTag('admin')).container.textContent).toContain('后台分配');
    expect(render(sourceTag('client')).container.textContent).toContain('客户端自建');
    expect(render(platformTag('xiaohongshu')).container.textContent).toContain('小红书');
    expect(render(platformTag('facebook')).container.textContent).toContain('Facebook');
  });

  it('falls back to raw value (no crash) for unknown enum values', () => {
    expect(render(statusTag('quarantined')).container.textContent).toContain('quarantined');
    expect(render(sourceTag('imported')).container.textContent).toContain('imported');
    expect(render(platformTag('douyin')).container.textContent).toContain('douyin');
  });

  it('renders null platform as an em dash placeholder', () => {
    expect(render(platformTag(null)).container.textContent).toContain('—');
  });
});
