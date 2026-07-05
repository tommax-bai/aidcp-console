import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Link,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { APP_ROUTES, NAV_ROUTES } from './routes';

vi.mock('./pages/AccountsPage', () => ({ AccountsPage: () => 'Accounts Page' }));
vi.mock('./pages/ContentPage', () => ({ ContentPage: () => 'Content Page' }));
vi.mock('./pages/ContentSchedulePage', () => ({ ContentSchedulePage: () => 'Content Schedule Page' }));
vi.mock('./pages/CuratedContentPage', () => ({ CuratedContentPage: () => 'Curated Content Page' }));
vi.mock('./pages/DashboardPage', () => ({ DashboardPage: () => 'Dashboard Home' }));
vi.mock('./pages/NotificationContactsPage', () => ({ NotificationContactsPage: () => 'Notification Contacts Page' }));
vi.mock('./pages/PersonaPage', () => ({ PersonaPage: () => 'Persona Page' }));
vi.mock('./pages/QuotasPage', () => ({ QuotasPage: () => 'Quotas Page' }));
vi.mock('./pages/RolesPage', () => ({ RolesPage: () => 'Roles Page' }));
vi.mock('./pages/SettingsPage', () => ({ SettingsPage: () => 'Settings Page' }));
vi.mock('./pages/TokenUsagePage', () => ({ TokenUsagePage: () => 'Token Usage Page' }));

function TestRequireAuth({ authed }: { authed: boolean }) {
  const location = useLocation();
  return authed ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  );
}

function TestShell() {
  const location = useLocation();

  return (
    <>
      <nav aria-label="主业务">
        {NAV_ROUTES.map((route) => (
          <Link key={route.path} to={route.path}>
            {route.navLabel}
          </Link>
        ))}
      </nav>
      <span data-testid="current-path">{location.pathname}</span>
      <Outlet />
    </>
  );
}

function LoginRoute() {
  const location = useLocation();

  return (
    <>
      <span data-testid="current-path">{location.pathname}</span>
      <div>Login Page</div>
    </>
  );
}

function renderRoute(path: string, authed: boolean) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<TestRequireAuth authed={authed} />}>
          <Route element={<TestShell />}>
            {APP_ROUTES.map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('/intro.html route alias', () => {
  it('uses the normal login guard when the operator is unauthenticated', async () => {
    renderRoute('/intro.html', false);

    await waitFor(() => expect(screen.getByTestId('current-path').textContent).toBe('/login'));
    expect(screen.getByText('Login Page')).toBeTruthy();
  });

  it('redirects authenticated operators to the canonical home route', async () => {
    renderRoute('/intro.html', true);

    await waitFor(() => expect(screen.getByTestId('current-path').textContent).toBe('/'));
    expect(screen.getByText('Dashboard Home')).toBeTruthy();
  });

  it('keeps the intro alias hidden from business navigation', () => {
    const introRoute = APP_ROUTES.find((route) => route.path === '/intro.html');
    expect(introRoute?.showInNav).toBe(false);
    expect(NAV_ROUTES.some((route) => route.path === '/intro.html')).toBe(false);
  });
});
