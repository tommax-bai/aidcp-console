import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BulbOutlined,
  ClockCircleOutlined,
  ContactsOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FundOutlined,
  ApartmentOutlined,
  IdcardOutlined,
  KeyOutlined,
  NotificationOutlined,
  MessageOutlined,
  OrderedListOutlined,
  RobotOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { AccountsPage } from './pages/AccountsPage';
import { ClientUsersPage } from './pages/ClientUsersPage';
import { ContentPage, PublishQueuePage } from './pages/ContentPage';
import { ContentSchedulePage } from './pages/ContentSchedulePage';
import { CuratedContentPage } from './pages/CuratedContentPage';
import { DashboardPage } from './pages/DashboardPage';
import { FacebookGroupsPage } from './pages/FacebookGroupsPage';
import { NotificationContactsPage } from './pages/NotificationContactsPage';
import { NotificationRoutesPage } from './pages/NotificationRoutesPage';
import { PersonaPage } from './pages/PersonaPage';
import { QuotasPage } from './pages/QuotasPage';
import { RolesPage } from './pages/RolesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TokenUsagePage } from './pages/TokenUsagePage';
import { WechatStrategiesPage } from './pages/WechatStrategiesPage';

export type NavGroupId = 'overview' | 'accounts' | 'content' | 'interaction' | 'ai-config' | 'system';

export interface NavGroup {
  id: NavGroupId;
  label: string;
  icon: ReactNode;
}

/** Stable first-level information architecture. Destinations stay in APP_ROUTES below. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'overview', label: '总览', icon: <DashboardOutlined /> },
  { id: 'accounts', label: '账号', icon: <TeamOutlined /> },
  { id: 'content', label: '内容', icon: <FileTextOutlined /> },
  { id: 'interaction', label: '互动', icon: <ContactsOutlined /> },
  { id: 'ai-config', label: 'AI 配置', icon: <RobotOutlined /> },
  { id: 'system', label: '系统', icon: <SettingOutlined /> },
];

/**
 * 应用路由 + 顶部导航的单一来源（change console-cloud-panel-hardening #37）。
 *
 * 收口原先两份手工清单：`App.tsx` 的 createBrowserRouter children 与 `AppShell.tsx` 的导航数组。
 * App.tsx 从本数组 map 出受保护路由；AppShell.tsx 从本数组派生桌面分组浮层与窄屏分组菜单。
 * 各分组内的数组顺序即浮层菜单展示顺序；路由表按 path 精确匹配、与顺序无关。
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
  /** 所属一级业务分组；设置也携带分组上下文，但不进入业务导航。 */
  navGroup?: NavGroupId;
  /** 是否出现在顶部业务胶囊导航。 */
  showInNav?: boolean;
}

export interface NavRoute extends AppRoute {
  navLabel: string;
  navIcon: ReactNode;
  navGroup: NavGroupId;
  showInNav: true;
}

/** 受保护路由（AppShell 下）+ 导航元数据。数组顺序 = 各分组内菜单顺序。 */
export const APP_ROUTES: AppRoute[] = [
  { path: '/', element: <DashboardPage />, navLabel: '数据', navIcon: <DashboardOutlined />, navGroup: 'overview', showInNav: true },
  { path: '/accounts', element: <AccountsPage />, navLabel: '账号', navIcon: <TeamOutlined />, navGroup: 'accounts', showInNav: true },
  { path: '/wechat-strategies', element: <WechatStrategiesPage />, navLabel: '视频号策略', navIcon: <MessageOutlined />, navGroup: 'accounts', showInNav: true },
  { path: '/facebook-groups', element: <FacebookGroupsPage />, navLabel: '群组', navIcon: <ApartmentOutlined />, navGroup: 'accounts', showInNav: true },
  { path: '/content', element: <ContentPage />, navLabel: '内容', navIcon: <FileTextOutlined />, navGroup: 'content', showInNav: true },
  { path: '/publish-queue', element: <PublishQueuePage />, navLabel: '发布队列', navIcon: <OrderedListOutlined />, navGroup: 'content', showInNav: true },
  { path: '/curated', element: <CuratedContentPage />, navLabel: '精选', navIcon: <BulbOutlined />, navGroup: 'content', showInNav: true },
  { path: '/content-schedule', element: <ContentSchedulePage />, navLabel: '排期', navIcon: <ClockCircleOutlined />, navGroup: 'content', showInNav: true },
  { path: '/notification-contacts', element: <NotificationContactsPage />, navLabel: '互动联系人', navIcon: <ContactsOutlined />, navGroup: 'interaction', showInNav: true },
  { path: '/notification-routes', element: <NotificationRoutesPage />, navLabel: '通知路由', navIcon: <NotificationOutlined />, navGroup: 'interaction', showInNav: true },
  { path: '/persona', element: <PersonaPage />, navLabel: '人设', navIcon: <IdcardOutlined />, navGroup: 'ai-config', showInNav: true },
  { path: '/roles', element: <RolesPage />, navLabel: '角色', navIcon: <RobotOutlined />, navGroup: 'ai-config', showInNav: true },
  { path: '/quotas', element: <QuotasPage />, navLabel: '安全', navIcon: <SafetyOutlined />, navGroup: 'system', showInNav: true },
  // 旧静态入口 `/intro.html` 由 Nginx 返回同一个 SPA 壳；客户端侧收敛到规范首页，避免应用内 404。
  { path: '/intro.html', element: <Navigate to="/" replace />, showInNav: false },
  // 监控页已并入首页（merge-monitor-into-dashboard）：旧路径重定向护住书签与「登录后回原页」的来源路径。
  { path: '/monitor', element: <Navigate to="/" replace />, showInNav: false },
  { path: '/usage', element: <TokenUsagePage />, navLabel: '用量', navIcon: <FundOutlined />, navGroup: 'system', showInNav: true },
  { path: '/client-users', element: <ClientUsersPage />, navLabel: '端用户', navIcon: <KeyOutlined />, navGroup: 'system', showInNav: true },
  // 设置：右上独立圆按钮呈现（AppShell），不入业务胶囊，故 showInNav=false；仍需在此登记以派生路由表。
  { path: '/settings', element: <SettingsPage />, navGroup: 'system', showInNav: false },
];

/** 可见业务导航项（从路由单一来源派生，保持各分组内数组顺序）。 */
export const NAV_ROUTES = APP_ROUTES.filter(
  (route): route is NavRoute =>
    route.showInNav === true && Boolean(route.navLabel) && Boolean(route.navIcon) && Boolean(route.navGroup),
);

export function navRoutesForGroup(groupId: NavGroupId): NavRoute[] {
  return NAV_ROUTES.filter((route) => route.navGroup === groupId);
}
