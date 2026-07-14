import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { buildDownloadMenuItems } from './AppShell';
import type { DownloadsManifest } from '../types/api';

/**
 * 下载菜单（change downloads-manifest-from-host）。
 *
 * 红线：安装包版本**不是源码，是部署状态**——它描述「这台机器的 downloads 目录里放了哪个包」。
 * 过去写死在源码里，于是主干无论填哪个版本，对另一台机器都是谎话（dev 死链 / ol 回退）。
 * 现在清单由云端现扫该机目录得出，前端**只渲染云端确认存在的文件**；拿不到就诚实说没有，
 * 绝不回落到写死版本、绝不产出未经证实的链接。
 */
describe('AppShell download menu — never offers a link it has not confirmed', () => {
  const manifest: DownloadsManifest = {
    version: '0.3.18',
    items: [
      { key: 'mac-arm64', label: 'macOS · Apple 芯片（M 系列）', file: 'AIDCP-0.3.18-arm64.dmg', version: '0.3.18' },
      { key: 'win-x64', label: 'Windows · x64', file: 'AIDCP Setup 0.3.5.exe', version: '0.3.5' },
    ],
  };

  it('renders exactly the installers the host reported, with its version', () => {
    const items = buildDownloadMenuItems(manifest, false);
    expect(items[0]).toMatchObject({ key: 'ver', label: '边缘客户端 v0.3.18' });
    expect(items).toHaveLength(3);

    const mac = render(items[1].label as React.ReactElement).container.querySelector('a');
    expect(mac?.getAttribute('href')).toBe('/downloads/AIDCP-0.3.18-arm64.dmg');
    // Windows 包名带空格，必须转义，否则链接在浏览器里断掉。
    const win = render(items[2].label as React.ReactElement).container.querySelector('a');
    expect(win?.getAttribute('href')).toBe('/downloads/AIDCP%20Setup%200.3.5.exe');
  });

  it('shows an honest empty state when the host has no installer — and emits no link', () => {
    const items = buildDownloadMenuItems({ version: null, items: [] }, false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'none', disabled: true, label: '暂无可用安装包' });
    expect(JSON.stringify(items)).not.toContain('/downloads/');
  });

  it('shows an honest empty state when the manifest could not be fetched — never falls back to a baked-in version', () => {
    const items = buildDownloadMenuItems(undefined, false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'none', disabled: true });
    // 关键回归：绝不能因为拿不到清单就掏出一个源码里写死的版本号（那就是本 change 要根除的 bug）。
    expect(JSON.stringify(items)).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('says it is still loading rather than claiming there is nothing', () => {
    const items = buildDownloadMenuItems(undefined, true);
    expect(items[0]).toMatchObject({ key: 'none', disabled: true, label: '正在读取安装包…' });
  });
});
