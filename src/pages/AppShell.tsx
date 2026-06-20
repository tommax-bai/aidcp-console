import { Dropdown, Layout, Menu, Select, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { key: '/', label: 'Dashboard' },
  { key: '/accounts', label: 'Accounts' },
  { key: '/content', label: 'Content' },
  { key: '/monitor', label: 'Monitor' },
  { key: '/settings', label: 'Settings' },
];

/**
 * 应用外壳（design PAGE 2）：顶栏（品牌 + 全局账号筛选器 + 用户）+ 左导航 + Outlet。
 * 全局账号筛选器（§3.1）：MVP 仅作用于诚实可切的 roster 表；metrics/monitor 在归因待补时中性化。
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const selectedKey = NAV.find((n) => n.key === location.pathname)?.key ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Typography.Text strong style={{ color: '#fff' }}>
          AIDCP
        </Typography.Text>
        <Select
          size="small"
          defaultValue="all"
          style={{ width: 200 }}
          options={[{ label: 'All accounts', value: 'all' }]}
        />
        <span style={{ flex: 1 }} />
        <Dropdown menu={{ items: [{ key: 'logout', label: 'Sign out', onClick: logout }] }}>
          <Typography.Text style={{ color: '#fff', cursor: 'pointer' }}>user ▾</Typography.Text>
        </Dropdown>
      </Layout.Header>
      <Layout>
        <Layout.Sider theme="light" width={160}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={NAV}
            onClick={({ key }) => navigate(key)}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 16 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
