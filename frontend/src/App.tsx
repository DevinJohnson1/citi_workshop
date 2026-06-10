import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { OidcCallback } from './pages/OidcCallback';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { ReportsPage } from './pages/ReportsPage';
import { AdminPage } from './pages/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Top-level router. CloudFront rewrites unknown paths to /index.html so the
 * SPA can take over (SYSTEM_DESIGN §8).
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
            element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
          />
          <Route
            path="/projects"
            element={<ProtectedRoute><ProjectsListPage /></ProtectedRoute>}
          />
          <Route
            path="/projects/:id"
            element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>}
          />
          <Route
            path="/resources"
            element={<ProtectedRoute><ResourcesPage /></ProtectedRoute>}
          />
          <Route
            path="/reports"
            element={<ProtectedRoute><ReportsPage /></ProtectedRoute>}
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

