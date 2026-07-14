import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import SetupPage from '@/features/setup/SetupPage'
import AdminLayout from '@/features/admin/AdminLayout'
import LoginPage from '@/features/admin/LoginPage'
import DashboardPage from '@/features/admin/DashboardPage'
import ForwardingPage from '@/features/admin/ForwardingPage'
import CapacityPage from '@/features/admin/CapacityPage'
import HostingPage from '@/features/admin/HostingPage'
import ScriptInjectionPage from '@/features/admin/ScriptInjectionPage'
import ScriptsPage from '@/features/admin/ScriptsPage'
import SessionsPage from '@/features/admin/SessionsPage'
import SessionDetailPage from '@/features/admin/SessionDetailPage'
import AdminKeyPage from '@/features/admin/AdminKeyPage'
import OpenApiPage from '@/features/admin/OpenApiPage'
import DiagnosticsLayout from '@/features/admin/diagnostics/DiagnosticsLayout'
import DiagnosticsOverviewPage from '@/features/admin/diagnostics/DiagnosticsOverviewPage'
import DiagnosticsEventsPage from '@/features/admin/diagnostics/DiagnosticsEventsPage'
import DiagnosticsLivePage from '@/features/admin/diagnostics/DiagnosticsLivePage'
import DiagnosticsProbesPage from '@/features/admin/diagnostics/DiagnosticsProbesPage'
import DiagnosticsConfigPage from '@/features/admin/diagnostics/DiagnosticsConfigPage'

const MotorPage = lazy(() => import('@/features/motor/live/MotorPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>
        }
      >
        <Routes>
          <Route path="/" element={<MotorPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="forwarding" element={<ForwardingPage />} />
            <Route path="capacity" element={<CapacityPage />} />
            <Route path="max-sessions" element={<Navigate to="/admin/capacity" replace />} />
            <Route path="js-bridge" element={<Navigate to="/admin/capacity" replace />} />
            <Route path="session-policy" element={<Navigate to="/admin/capacity" replace />} />
            <Route path="hosting" element={<HostingPage />} />
            <Route path="script-injection" element={<ScriptInjectionPage />} />
            <Route path="scripts" element={<ScriptsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
            <Route path="diagnostics" element={<DiagnosticsLayout />}>
              <Route index element={<DiagnosticsOverviewPage />} />
              <Route path="events" element={<DiagnosticsEventsPage />} />
              <Route path="live" element={<DiagnosticsLivePage />} />
              <Route path="probes" element={<DiagnosticsProbesPage />} />
              <Route path="config" element={<DiagnosticsConfigPage />} />
            </Route>
            <Route path="api-key" element={<AdminKeyPage />} />
            <Route path="openapi" element={<OpenApiPage />} />
          </Route>
          <Route path="*" element={<MotorPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
