import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { OidcCallback } from './pages/OidcCallback';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectCreatePage } from './pages/ProjectCreatePage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { ReportsPage } from './pages/ReportsPage';
import { AdminPage } from './pages/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Top-level router. CloudFront rewrites unknown paths to /index.html so the
 * SPA can take over (SYSTEM_DESIGN §8).
 *
 * Role matrix (UI-gated; backend re-enforces in `_lib/auth.py`):
 *   - admin:       `/admin` only — manages user accounts (no project work).
 *   - team_lead:   dashboard, projects (incl. create), project detail,
 *                  resources (full write), reports.
 *   - team_member: dashboard, projects (read), project detail, resources
 *                  (create with pending approval), reports.
 *   - viewer:      dashboard (read-only summary) and reports.
 */
export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/callback" element={<OidcCallback />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireRole={['team_lead', 'team_member', 'viewer']}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedRoute requireRole={['team_lead', 'team_member']}>
                <ProjectsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/new"
            element={
              <ProtectedRoute requireRole={['team_lead']}>
                <ProjectCreatePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProtectedRoute requireRole={['team_lead', 'team_member']}>
                <ProjectDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/resources"
            element={
              <ProtectedRoute requireRole={['team_lead', 'team_member']}>
                <ResourcesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute requireRole={['team_lead', 'team_member', 'viewer']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={<ProtectedRoute requireRole="admin"><AdminPage /></ProtectedRoute>}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

