import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './pages/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { ContentPage } from './pages/ContentPage';
import { MonitorPage } from './pages/MonitorPage';
import { RolesPage } from './pages/RolesPage';
import { PersonaPage } from './pages/PersonaPage';
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
          { path: '/monitor', element: <MonitorPage /> },
          { path: '/roles', element: <RolesPage /> },
          { path: '/persona', element: <PersonaPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
