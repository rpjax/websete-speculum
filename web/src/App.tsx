import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import SetupPage from '@/features/setup/SetupPage'
import AdminLayout from '@/features/admin/AdminLayout'
import LoginPage from '@/features/admin/LoginPage'
import DashboardPage from '@/features/admin/DashboardPage'
import ForwardingPage from '@/features/admin/ForwardingPage'
import MaxSessionsPage from '@/features/admin/MaxSessionsPage'
import JsBridgePage from '@/features/admin/JsBridgePage'
import SessionPolicyPage from '@/features/admin/SessionPolicyPage'
import HostingPage from '@/features/admin/HostingPage'
import ScriptInjectionPage from '@/features/admin/ScriptInjectionPage'
import ScriptsPage from '@/features/admin/ScriptsPage'
import SessionsPage from '@/features/admin/SessionsPage'
import SessionDetailPage from '@/features/admin/SessionDetailPage'
import AdminKeyPage from '@/features/admin/AdminKeyPage'
import OpenApiPage from '@/features/admin/OpenApiPage'

const MotorPage = lazy(() => import('@/features/motor/MotorPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
        <Routes>
          <Route path="/" element={<MotorPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="forwarding" element={<ForwardingPage />} />
            <Route path="max-sessions" element={<MaxSessionsPage />} />
            <Route path="js-bridge" element={<JsBridgePage />} />
            <Route path="session-policy" element={<SessionPolicyPage />} />
            <Route path="hosting" element={<HostingPage />} />
            <Route path="script-injection" element={<ScriptInjectionPage />} />
            <Route path="scripts" element={<ScriptsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
            <Route path="api-key" element={<AdminKeyPage />} />
            <Route path="openapi" element={<OpenApiPage />} />
          </Route>
          <Route path="*" element={<MotorPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
