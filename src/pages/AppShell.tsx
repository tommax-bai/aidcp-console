import { Dropdown, type MenuProps } from 'antd';
import {
  CheckOutlined,
  DeploymentUnitOutlined,
  DownOutlined,
  DownloadOutlined,
  MenuOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { edgeDownloadUrl } from '../config/downloads';
import { useDownloads } from '../api/queries';
import type { DownloadsManifest } from '../types/api';
import {
  APP_ROUTES,
  NAV_GROUPS,
  NAV_ROUTES,
  navRoutesForGroup,
  type NavGroup,
  type NavRoute,
} from '../routes';

/** 当前路径是否命中某入口（'/' 精确匹配，其余需落在路径边界内，子路由保持高亮）。 */
export function isActive(pathname: string, key: string): boolean {
  return key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(`${key}/`);
}

export interface ActiveNavigation {
  group: NavGroup;
  destination?: NavRoute;
}

/** Resolve one stable group and, when visible, one destination from the current URL. */
export function getActiveNavigation(pathname: string): ActiveNavigation {
  const route = APP_ROUTES.find((candidate) => isActive(pathname, candidate.path));
  const group = NAV_GROUPS.find((candidate) => candidate.id === route?.navGroup) ?? NAV_GROUPS[0];
  const destination = route?.showInNav ? NAV_ROUTES.find((candidate) => candidate.path === route.path) : undefined;
  return { group, destination };
}

function buildMobileNavigationItems(): MenuProps['items'] {
  return NAV_GROUPS.map((group) => ({
    key: `group:${group.id}`,
    type: 'group' as const,
    label: (
      <span className="mobile-nav-menu__group">
        {group.icon}
        <span>{group.label}</span>
      </span>
    ),
    children: navRoutesForGroup(group.id).map((route) => ({
      key: route.path,
      icon: route.navIcon,
      label: (
        <Link className="mobile-nav-menu__link" to={route.path}>
          {route.navLabel}
        </Link>
      ),
    })),
  }));
}

function buildGroupNavigationItems(group: NavGroup, pathname: string): MenuProps['items'] {
  return navRoutesForGroup(group.id).map((route) => {
    const active = isActive(pathname, route.path);
    return {
      key: route.path,
      label: (
        <Link
          className="group-nav-menu__link"
          to={route.path}
          aria-current={active ? 'page' : undefined}
        >
          <span className="group-nav-menu__icon" aria-hidden="true">{route.navIcon}</span>
          <span className="group-nav-menu__label">{route.navLabel}</span>
          {active ? <CheckOutlined className="group-nav-menu__check" aria-hidden="true" /> : null}
        </Link>
      ),
    };
  });
}

/**
 * 应用外壳（design PAGE 2）：单行顶部业务分组 + 悬浮子菜单 + 居中内容（弃侧栏）。
 * 左品牌 / 中业务分组（窄屏为带文字菜单）/ 右下载客户端 + 设置圆按钮 + 用户菜单。
 * 注：原右侧「全局账号筛选器（§3.1）」已移除——归因已流通（V1 task 9.6），按账号切片改由各页面用真实 API 数据各自完成。
 */
/**
 * 下载菜单项（change downloads-manifest-from-host）：清单由云端**现扫本机 downloads 目录**得出。
 * 红线：清单为空 / 还没拿到 / 取失败时，MUST 只给一个不可点的说明项——**绝不回落写死版本号，
 * 也绝不产出任何未经证实的下载链接**。菜单里出现的每一个链接，都对应那台机器上真实存在的文件。
 * 抽成纯函数便于单测（避开 Dropdown portal 的 flaky）。
 */
export function buildDownloadMenuItems(manifest: DownloadsManifest | undefined, isPending: boolean) {
  const items = manifest?.items ?? [];
  if (!items.length) {
    return [{ key: 'none', disabled: true, label: isPending ? '正在读取安装包…' : '暂无可用安装包' }];
  }
  return [
    { key: 'ver', type: 'group' as const, label: `边缘客户端 v${manifest?.version ?? ''}` },
    ...items.map((it) => ({
      key: it.key,
      label: (
        <a href={edgeDownloadUrl(it.file)} download>
          {it.label}
        </a>
      ),
    })),
  ];
}

export function AppShell() {
  const location = useLocation();
  const { logout } = useAuth();
  const pathname = location.pathname;
  const downloads = useDownloads();
  const downloadMenuItems = buildDownloadMenuItems(downloads.data, downloads.isPending);
  const activeNavigation = getActiveNavigation(pathname);
  const currentLocationLabel = activeNavigation.destination?.navLabel
    ?? (isActive(pathname, '/settings') ? '设置' : activeNavigation.group.label);
  const mobileNavigationItems = buildMobileNavigationItems();

  return (
    <div className="app-shell">
      <header className="top-nav" role="banner">
        <div className="top-nav__primary">
          <div className="top-nav__inner">
            {/* 左：品牌 */}
            <Link to="/" className="brand">
              <span className="brand__logo" aria-hidden="true">
                <DeploymentUnitOutlined className="brand-glyph" />
              </span>
              <span className="brand__text">
                <span className="brand__title">AIDCP</span>
                <span className="brand__sub">运营管理后台</span>
              </span>
            </Link>

            {/* 中：稳定的一级业务分组 */}
            <nav className="pill pill--groups top-nav__desktop-nav" aria-label="业务分组">
              {NAV_GROUPS.map((group) => {
                const routes = navRoutesForGroup(group.id);
                const groupIsActive = activeNavigation.group.id === group.id;
                const groupClassName = `pill__btn${groupIsActive ? ' pill__btn--active' : ''}`;

                if (routes.length === 1) {
                  return (
                    <Link
                      key={group.id}
                      to={routes[0].path}
                      className={groupClassName}
                      aria-current={groupIsActive ? 'page' : undefined}
                    >
                      <span className="pill__icon" aria-hidden="true">{group.icon}</span>
                      <span>{group.label}</span>
                    </Link>
                  );
                }

                return (
                  <Dropdown
                    key={group.id}
                    trigger={['hover', 'click']}
                    placement="bottom"
                    mouseEnterDelay={0.12}
                    mouseLeaveDelay={0.2}
                    overlayClassName="group-nav-dropdown"
                    menu={{
                      items: buildGroupNavigationItems(group, pathname),
                      selectedKeys: activeNavigation.destination?.navGroup === group.id
                        ? [activeNavigation.destination.path]
                        : [],
                    }}
                  >
                    <button
                      type="button"
                      className={groupClassName}
                      aria-label={`打开${group.label}分组菜单`}
                      aria-current={groupIsActive ? 'location' : undefined}
                      aria-haspopup="menu"
                    >
                      <span className="pill__icon" aria-hidden="true">{group.icon}</span>
                      <span>{group.label}</span>
                      <DownOutlined className="pill__chevron" aria-hidden="true" />
                    </button>
                  </Dropdown>
                );
              })}
            </nav>

            {/* 窄屏：保留当前地点文字，展开后按相同六分组展示全部入口。 */}
            <div className="top-nav__mobile-nav">
              <Dropdown
                trigger={['click']}
                placement="bottom"
                menu={{
                  items: mobileNavigationItems,
                  selectedKeys: activeNavigation.destination ? [activeNavigation.destination.path] : [],
                }}
              >
                <button
                  type="button"
                  className="top-nav__menu-trigger"
                  aria-label={`打开导航菜单，当前位置：${activeNavigation.group.label}，${currentLocationLabel}`}
                >
                  <MenuOutlined aria-hidden="true" />
                  <span className="top-nav__menu-label">
                    <span className="top-nav__menu-group">{activeNavigation.group.label}</span>
                    <span className="top-nav__menu-separator" aria-hidden="true">·</span>
                    <span className="top-nav__menu-destination">{currentLocationLabel}</span>
                  </span>
                  <DownOutlined className="top-nav__menu-chevron" aria-hidden="true" />
                </button>
              </Dropdown>
            </div>

            {/* 右：下载客户端 + 设置 + 用户 */}
            <div className="top-nav__actions">
              <Dropdown trigger={['click']} menu={{ items: downloadMenuItems }}>
                <button
                  type="button"
                  className="user-trigger user-trigger--icon"
                  title="下载客户端"
                  aria-label="下载边缘客户端"
                >
                  <DownloadOutlined />
                </button>
              </Dropdown>
              <Link
                to="/settings"
                className={`pill__circle${isActive(pathname, '/settings') ? ' pill__circle--active' : ''}`}
                title="设置"
                aria-label="设置"
              >
                <SettingOutlined />
              </Link>
              <Dropdown
                trigger={['click']}
                menu={{ items: [{ key: 'logout', label: '退出登录', onClick: logout }] }}
              >
                <button
                  type="button"
                  className="user-trigger user-trigger--icon"
                  title="管理"
                  aria-label="用户菜单"
                >
                  <UserOutlined />
                </button>
              </Dropdown>
            </div>
          </div>
        </div>

      </header>

      <main className="app-main">
        <div className="app-main__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
