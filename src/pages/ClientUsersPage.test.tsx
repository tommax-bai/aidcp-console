import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { statusTag, sourceTag, platformTag, copyToClipboard } from './ClientUsersPage';

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

/**
 * 锁一次性密钥复制的兜底不变量：明文 HTTP（非安全上下文）下 navigator.clipboard 为 undefined，
 * 必须退回 execCommand 选区复制并仍算成功，而非报「复制失败」。真机验收核 http://<ip>:8088 实际写入。
 */
describe('copyToClipboard — non-secure-context fallback', () => {
  const origClipboard = navigator.clipboard;
  // jsdom 不实现 execCommand，装一个可被断言的存根（真机走浏览器原生实现）。
  const origExec = (document as { execCommand?: unknown }).execCommand;
  const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  const stubExec = (ret: boolean) => {
    const exec = vi.fn().mockReturnValue(ret);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    return exec;
  };

  afterEach(() => {
    setClipboard(origClipboard);
    (document as unknown as { execCommand: unknown }).execCommand = origExec;
    vi.restoreAllMocks();
  });

  it('uses async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyToClipboard('ck_secret')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('ck_secret');
  });

  it('falls back to execCommand when clipboard API is absent (http context)', async () => {
    setClipboard(undefined);
    const exec = stubExec(true);
    await expect(copyToClipboard('ck_secret')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when clipboard API throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    const exec = stubExec(true);
    await expect(copyToClipboard('ck_secret')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('reports failure only when both paths fail', async () => {
    setClipboard(undefined);
    stubExec(false);
    await expect(copyToClipboard('ck_secret')).resolves.toBe(false);
  });
});
