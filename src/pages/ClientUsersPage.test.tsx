import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { statusTag, sourceTag, platformTag, copyToClipboard, assigneeCell } from './ClientUsersPage';
import type { ClientEnvironmentView } from '../types/api';

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

/**
 * 锁「多人」标识逻辑（change client-user-env-picker）：≥2 客户 → 「多人（N）」；===1 → 单客户名；
 * 0 / 未在注册表 → 破折号。纯渲染、无 portal，不 flaky。抽屉勾选加入 / 待分配已分配筛选交互属 portal
 * 重、桩 flaky（memory: console-antd-popconfirm-test-gotcha）→ 真机核。
 */
describe('assigneeCell — 多人 / 单客户 / 空 标识', () => {
  const mk = (n: number): ClientEnvironmentView => ({
    envKey: 'p1',
    label: null,
    platform: null,
    assignees: Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `客户${i}` })),
    assigneeCount: n,
  });

  it('assigneeCount >= 2 renders 多人 badge with count', () => {
    const txt = render(assigneeCell(mk(3))).container.textContent ?? '';
    expect(txt).toContain('多人');
    expect(txt).toContain('3');
  });

  it('assigneeCount === 1 renders the single customer name (no 多人)', () => {
    const txt = render(assigneeCell(mk(1))).container.textContent ?? '';
    expect(txt).toContain('客户0');
    expect(txt).not.toContain('多人');
  });

  it('undefined or zero assignees renders an em dash', () => {
    expect(render(assigneeCell(undefined)).container.textContent).toContain('—');
    expect(render(assigneeCell(mk(0))).container.textContent).toContain('—');
  });
});
