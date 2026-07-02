import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './pages/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { ContentPage } from './pages/ContentPage';
import { ContentSchedulePage } from './pages/ContentSchedulePage';
import { CuratedContentPage } from './pages/CuratedContentPage';
import { MonitorPage } from './pages/MonitorPage';
import { RolesPage } from './pages/RolesPage';
import { QuotasPage } from './pages/QuotasPage';
import { PersonaPage } from './pages/PersonaPage';
import { TokenUsagePage } from './pages/TokenUsagePage';
import { NotificationContactsPage } from './pages/NotificationContactsPage';
import { SettingsPage } from './pages/SettingsPage';

/** 路由守卫：未鉴权跳登录。 */
function RequireAuth() {
  const { authed } = useAuth();
  return authed ? <Outlet /> : <Navigate to="/login" replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/accounts', element: <AccountsPage /> },
          { path: '/content', element: <ContentPage /> },
          { path: '/content-schedule', element: <ContentSchedulePage /> },
          { path: '/curated', element: <CuratedContentPage /> },
          { path: '/monitor', element: <MonitorPage /> },
          { path: '/roles', element: <RolesPage /> },
          { path: '/quotas', element: <QuotasPage /> },
          { path: '/persona', element: <PersonaPage /> },
          { path: '/usage', element: <TokenUsagePage /> },
          { path: '/notification-contacts', element: <NotificationContactsPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
