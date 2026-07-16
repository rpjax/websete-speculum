import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
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
import SessionDetailPage from '@/features/admin/sessions/SessionDetailPage'
import AdminKeyPage from '@/features/admin/AdminKeyPage'
import OpenApiPage from '@/features/admin/OpenApiPage'
import DiagnosticsLayout from '@/features/admin/diagnostics/DiagnosticsLayout'
import DiagnosticsHealthPage from '@/features/admin/diagnostics/DiagnosticsHealthPage'
import DiagnosticsSystemHealthPage from '@/features/admin/diagnostics/DiagnosticsSystemHealthPage'
import DiagnosticsTelemetryPage from '@/features/admin/diagnostics/DiagnosticsTelemetryPage'
import DiagnosticsTelemetryExplorePage from '@/features/admin/diagnostics/DiagnosticsTelemetryExplorePage'
import DiagnosticsActivityPage from '@/features/admin/diagnostics/DiagnosticsActivityPage'
import DiagnosticsInvestigatePage from '@/features/admin/diagnostics/DiagnosticsInvestigatePage'
import DiagnosticsGovernancePage from '@/features/admin/diagnostics/DiagnosticsGovernancePage'
import DiagnosticsTimelinePage from '@/features/admin/diagnostics/DiagnosticsTimelinePage'

const MotorPage = lazy(() => import('@/features/motor/live/MotorPage'))

function DiagnosticsSessionRedirect() {
  const { connectionId } = useParams<{ connectionId: string }>()
  return <Navigate to={`/admin/sessions/${connectionId}`} replace />
}

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
            <Route path="sessions/:id" element={<SessionDetailPage />} />
            <Route path="diagnostics" element={<DiagnosticsLayout />}>
              <Route index element={<DiagnosticsHealthPage />} />
              <Route path="health" element={<DiagnosticsSystemHealthPage />} />
              <Route path="telemetry" element={<DiagnosticsTelemetryPage />} />
              <Route path="resources" element={<Navigate to="/admin/diagnostics/telemetry" replace />} />
              <Route path="activity" element={<DiagnosticsActivityPage />} />
              <Route path="sessions" element={<Navigate to="/admin/sessions" replace />} />
              <Route path="investigate" element={<DiagnosticsInvestigatePage />} />
              <Route path="governance" element={<DiagnosticsGovernancePage />} />
              <Route path="timeline" element={<DiagnosticsTimelinePage />} />
              <Route path="events" element={<Navigate to="/admin/diagnostics/activity" replace />} />
              <Route path="live" element={<Navigate to="/admin/sessions" replace />} />
              <Route path="probes" element={<Navigate to="/admin/diagnostics/investigate" replace />} />
              <Route path="config" element={<Navigate to="/admin/diagnostics/governance" replace />} />
            </Route>
            <Route path="diagnostics/telemetry/explore" element={<DiagnosticsTelemetryExplorePage />} />
            <Route path="diagnostics/sessions/:connectionId" element={<DiagnosticsSessionRedirect />} />
            <Route path="api-key" element={<AdminKeyPage />} />
            <Route path="openapi" element={<OpenApiPage />} />
          </Route>
          <Route path="*" element={<MotorPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
