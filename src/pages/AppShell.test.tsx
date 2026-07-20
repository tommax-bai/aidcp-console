import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell, buildDownloadMenuItems, getActiveNavigation, isActive } from './AppShell';
import type { DownloadsManifest } from '../types/api';
import { NAV_GROUPS, NAV_ROUTES, navRoutesForGroup } from '../routes';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../api/queries', () => ({
  useDownloads: () => ({ data: { version: null, items: [] }, isPending: false }),
}));

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

describe('AppShell top navigation active route matching', () => {
  it('does not mark the Content tab active while the Schedule tab is selected', () => {
    expect(isActive('/content-schedule', '/content-schedule')).toBe(true);
    expect(isActive('/content-schedule', '/content')).toBe(false);
  });

  it('keeps nested routes active for their owning top-level tab', () => {
    expect(isActive('/content/drafts', '/content')).toBe(true);
    expect(isActive('/content-schedule/accounts', '/content-schedule')).toBe(true);
  });
});

describe('AppShell grouped navigation model', () => {
  it('keeps six stable labelled groups and assigns all fifteen visible destinations exactly once', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['总览', '账号', '内容', '互动', 'AI 配置', '系统']);
    expect(NAV_ROUTES).toHaveLength(15);

    const knownGroupIds = new Set(NAV_GROUPS.map((group) => group.id));
    expect(NAV_ROUTES.every((route) => knownGroupIds.has(route.navGroup))).toBe(true);
    expect(NAV_GROUPS.flatMap((group) => navRoutesForGroup(group.id))).toEqual(NAV_ROUTES);
  });

  it('keeps the approved destination order inside every group', () => {
    const labelsByGroup = Object.fromEntries(
      NAV_GROUPS.map((group) => [group.id, navRoutesForGroup(group.id).map((route) => route.navLabel)]),
    );

    expect(labelsByGroup).toEqual({
      overview: ['数据'],
      accounts: ['账号', '视频号策略', '群组'],
      content: ['内容', '发布队列', '精选', '排期'],
      interaction: ['互动联系人', '通知路由'],
      'ai-config': ['人设', '角色'],
      system: ['安全', '用量', '端用户'],
    });
  });

  it('derives both group and destination for direct and nested routes', () => {
    expect(getActiveNavigation('/content')).toMatchObject({
      group: { id: 'content' },
      destination: { path: '/content' },
    });
    expect(getActiveNavigation('/content/drafts')).toMatchObject({
      group: { id: 'content' },
      destination: { path: '/content' },
    });
    expect(getActiveNavigation('/content-schedule')).toMatchObject({
      group: { id: 'content' },
      destination: { path: '/content-schedule' },
    });
    expect(getActiveNavigation('/publish-queue')).toMatchObject({
      group: { id: 'content' },
      destination: { path: '/publish-queue' },
    });
  });

  it('keeps settings independent while retaining System group context', () => {
    const active = getActiveNavigation('/settings');
    expect(active.group.id).toBe('system');
    expect(active.destination).toBeUndefined();
  });

  it('renders one direct Overview link and five menu-backed desktop groups without a second row', () => {
    render(
      <MemoryRouter initialEntries={['/curated']}>
        <Routes>
          <Route path="*" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    );

    const primary = screen.getByRole('navigation', { name: '业务分组' });
    expect(within(primary).getAllByRole('link')).toHaveLength(1);
    expect(within(primary).getByRole('link', { name: '总览' }).getAttribute('href')).toBe('/');
    expect(within(primary).getAllByRole('button')).toHaveLength(5);
    expect(within(primary).getByRole('button', { name: '打开内容分组菜单' }).getAttribute('aria-current')).toBe('location');
    expect(screen.queryByRole('navigation', { name: '内容分组导航' })).toBeNull();
  });

  it('opens a compact current-group destination menu on hover and marks the current destination', async () => {
    render(
      <MemoryRouter initialEntries={['/curated']}>
        <Routes>
          <Route path="*" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: '打开内容分组菜单' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.mouseEnter(trigger);
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(trigger.className).toContain('pill__btn--open'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
    expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['内容', '发布队列', '精选', '排期']);
    expect(within(menu).getByRole('link', { name: '精选' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens a multi-destination group by click for touch and keyboard activation paths', async () => {
    render(
      <MemoryRouter initialEntries={['/quotas']}>
        <Routes>
          <Route path="*" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: '打开系统分组菜单' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(trigger.className).toContain('pill__btn--open');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['安全', '用量', '端用户']);
    expect(within(menu).getByRole('link', { name: '安全' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens a labelled narrow menu containing all destinations under six groups', async () => {
    render(
      <MemoryRouter initialEntries={['/curated']}>
        <Routes>
          <Route path="*" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单，当前位置：内容，精选' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('group')).toHaveLength(6);
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(15);
    await waitFor(() => expect(within(menu).getByText('视频号策略')).toBeTruthy());
    expect(within(menu).getByText('端用户')).toBeTruthy();
  });
});
