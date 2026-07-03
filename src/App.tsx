import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './pages/AppShell';
import { LoginPage } from './pages/LoginPage';
import { APP_ROUTES } from './routes';

/** 路由守卫：未鉴权跳登录。 */
function RequireAuth() {
  const { authed } = useAuth();
  const location = useLocation();
  // #24：带来源路径，登录后回原页（而非硬编码首页，保住工作现场：筛选/正在看的账号等）。
  return authed ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        // 路由清单从单一来源 APP_ROUTES 派生（#37），与 AppShell 的业务胶囊导航同源，避免两处手工维护漂移。
        children: APP_ROUTES.map((r) => ({ path: r.path, element: r.element })),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
