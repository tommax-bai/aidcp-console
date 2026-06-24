import { Dropdown, Select } from 'antd';
import {
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  IdcardOutlined,
  MonitorOutlined,
  RobotOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** 主业务入口（顶部居中胶囊导航）。 */
const BUSINESS: { key: string; label: string; icon: ReactNode }[] = [
  { key: '/', label: '数据看板', icon: <DashboardOutlined /> },
  { key: '/accounts', label: '账号', icon: <TeamOutlined /> },
  { key: '/content', label: '内容', icon: <FileTextOutlined /> },
  { key: '/monitor', label: '监控', icon: <MonitorOutlined /> },
  { key: '/roles', label: '角色配置', icon: <RobotOutlined /> },
  { key: '/quotas', label: '安全限额', icon: <SafetyOutlined /> },
  { key: '/persona', label: '人设', icon: <IdcardOutlined /> },
];

/** 当前路径是否命中某入口（'/' 精确匹配，其余按前缀，子路由保持高亮）。 */
function isActive(pathname: string, key: string): boolean {
  return key === '/' ? pathname === '/' : pathname.startsWith(key);
}

/**
 * 应用外壳（design PAGE 2）：视觉对齐 isales —— 顶部胶囊导航 + 居中内容（弃侧栏）。
 * 左品牌 / 中主业务胶囊 / 右全局账号筛选器 + 设置圆按钮 + 用户菜单。
 * 全局账号筛选器（§3.1）：MVP 仅作用于诚实可切的 roster 表；metrics/monitor 在归因待补时中性化。
 */
export function AppShell() {
  const location = useLocation();
  const { logout } = useAuth();
  const pathname = location.pathname;

  return (
    <div className="app-shell">
      <header className="top-nav" role="banner">
        <div className="top-nav__inner">
          {/* 左：品牌 */}
          <Link to="/" className="brand">
            <span className="brand__logo" aria-hidden="true">
              <DeploymentUnitOutlined />
            </span>
            <span className="brand__text">
              <span className="brand__title">AIDCP</span>
              <span className="brand__sub">运营管理后台</span>
            </span>
          </Link>

          {/* 中：主业务胶囊 */}
          <nav className="pill pill--business" aria-label="主业务">
            {BUSINESS.map((item) => (
              <Link
                key={item.key}
                to={item.key}
                className={`pill__btn${isActive(pathname, item.key) ? ' pill__btn--active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* 右：全局账号筛选 + 设置 + 用户 */}
          <div className="top-nav__actions">
            <Select
              size="small"
              defaultValue="all"
              style={{ width: 160 }}
              options={[{ label: '全部账号', value: 'all' }]}
            />
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
              <button type="button" className="user-trigger" aria-label="用户菜单">
                <UserOutlined />
                <span>管理员</span>
              </button>
            </Dropdown>
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
