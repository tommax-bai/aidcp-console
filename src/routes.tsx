import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BulbOutlined,
  ClockCircleOutlined,
  ContactsOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FundOutlined,
  IdcardOutlined,
  RobotOutlined,
  SafetyOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { AccountsPage } from './pages/AccountsPage';
import { ContentPage } from './pages/ContentPage';
import { ContentSchedulePage } from './pages/ContentSchedulePage';
import { CuratedContentPage } from './pages/CuratedContentPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotificationContactsPage } from './pages/NotificationContactsPage';
import { PersonaPage } from './pages/PersonaPage';
import { QuotasPage } from './pages/QuotasPage';
import { RolesPage } from './pages/RolesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TokenUsagePage } from './pages/TokenUsagePage';

/**
 * 应用路由 + 顶部导航的单一来源（change console-cloud-panel-hardening #37）。
 *
 * 收口原先两份手工清单：`App.tsx` 的 createBrowserRouter children 与 `AppShell.tsx` 的业务胶囊导航数组。
 * App.tsx 从本数组 map 出受保护路由；AppShell.tsx 从本数组 filter(showInNav) 派生业务胶囊。
 * 数组顺序即业务胶囊的展示顺序（可见行为，须保持）；路由表按 path 精确匹配、与顺序无关。
 * 登录路由 `/login` 结构上在 AppShell / RequireAuth 之外，仍单列于 App.tsx，不入本表。
 * 设置 `/settings` 在本表内（供路由表派生），但 showInNav=false——它在 AppShell 右上以独立圆按钮呈现，
 * 不进业务胶囊。
 */
export interface AppRoute {
  /** 路由路径（= 导航 key）。 */
  path: string;
  /** 页面元素。 */
  element: ReactNode;
  /** 业务胶囊导航文案（仅 showInNav 项有意义）。 */
  navLabel?: string;
  /** 业务胶囊导航图标（仅 showInNav 项有意义）。 */
  navIcon?: ReactNode;
  /** 是否出现在顶部业务胶囊导航。 */
  showInNav?: boolean;
}

/** 受保护路由（AppShell 下）+ 导航元数据。数组顺序 = 业务胶囊展示顺序。 */
export const APP_ROUTES: AppRoute[] = [
  { path: '/', element: <DashboardPage />, navLabel: '数据', navIcon: <DashboardOutlined />, showInNav: true },
  { path: '/accounts', element: <AccountsPage />, navLabel: '账号', navIcon: <TeamOutlined />, showInNav: true },
  { path: '/content-schedule', element: <ContentSchedulePage />, navLabel: '排期', navIcon: <ClockCircleOutlined />, showInNav: true },
  { path: '/content', element: <ContentPage />, navLabel: '内容', navIcon: <FileTextOutlined />, showInNav: true },
  { path: '/curated', element: <CuratedContentPage />, navLabel: '精选', navIcon: <BulbOutlined />, showInNav: true },
  { path: '/notification-contacts', element: <NotificationContactsPage />, navLabel: '互动联系人', navIcon: <ContactsOutlined />, showInNav: true },
  { path: '/persona', element: <PersonaPage />, navLabel: '人设', navIcon: <IdcardOutlined />, showInNav: true },
  { path: '/roles', element: <RolesPage />, navLabel: '角色', navIcon: <RobotOutlined />, showInNav: true },
  { path: '/quotas', element: <QuotasPage />, navLabel: '安全', navIcon: <SafetyOutlined />, showInNav: true },
  // 监控页已并入首页（merge-monitor-into-dashboard）：旧路径重定向护住书签与「登录后回原页」的来源路径。
  { path: '/monitor', element: <Navigate to="/" replace />, showInNav: false },
  { path: '/usage', element: <TokenUsagePage />, navLabel: '用量', navIcon: <FundOutlined />, showInNav: true },
  // 设置：右上独立圆按钮呈现（AppShell），不入业务胶囊，故 showInNav=false；仍需在此登记以派生路由表。
  { path: '/settings', element: <SettingsPage />, showInNav: false },
];

/** 顶部业务胶囊导航项（从单一来源派生，保持数组顺序）。 */
export const NAV_ROUTES = APP_ROUTES.filter((r) => r.showInNav);
