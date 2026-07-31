import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ReadinessGatePage } from '@/features/setup/ReadinessGatePage'
import { GuidedFirstConfigPage } from '@/features/setup/GuidedFirstConfigPage'
import { OperatorHomePage } from '@/features/admin/home/OperatorHomePage'
import { LiveSessionsPage } from '@/features/admin/sessions/LiveSessionsPage'
import { LiveSessionDetailPage } from '@/features/admin/sessions/LiveSessionDetailPage'
import { ProfilesListPage } from '@/features/admin/profiles/ProfilesListPage'
import { ProfileDetailPage } from '@/features/admin/profiles/ProfileDetailPage'
import { ProfileDeletePage } from '@/features/admin/profiles/ProfileDeletePage'
import { ChangePasswordPage } from '@/features/admin/auth/ChangePasswordPage'
import { LoginPage } from '@/features/admin/auth/LoginPage'
import { SessionExpiredPage } from '@/features/admin/auth/SessionExpiredPage'
import { AdminShell } from '@/features/admin/shell/AdminShell'
import { RequireAuth } from '@/features/admin/shell/RequireAuth'
import { ScriptsLayout } from '@/features/admin/scripts/ScriptsLayout'
import { ScriptsIndexPage } from '@/features/admin/scripts/ScriptsIndexPage'
import { UploadScriptPage } from '@/features/admin/scripts/UploadScriptPage'
import { InjectionFlow } from '@/features/admin/scripts/injection-flow/InjectionFlow'
import { RemoveInjectionPage } from '@/features/admin/scripts/RemoveInjectionPage'
import { ConfigurationsHubPage } from '@/features/admin/configurations/ConfigurationsHubPage'
import { ConfigurationSectionPage } from '@/features/admin/configurations/ConfigurationSectionPage'
import { HostResourcesPage } from '@/features/admin/host-resources/HostResourcesPage'
import { DiagnosticsHubPage } from '@/features/admin/diagnostics/DiagnosticsHubPage'
import { DiagnosticsHealthPage } from '@/features/admin/diagnostics/DiagnosticsHealthPage'
import { DiagnosticsTimelinePage } from '@/features/admin/diagnostics/DiagnosticsTimelinePage'
import { DiagnosticsInvestigatePage } from '@/features/admin/diagnostics/DiagnosticsInvestigatePage'
import { DiagnosticsGovernancePage } from '@/features/admin/diagnostics/DiagnosticsGovernancePage'

const SessionLabPage = lazy(() => import('@/features/sessions/lab/SessionLabPage'))
const SessionLivePage = lazy(() => import('@/features/sessions/live/SessionLivePage'))

export default function App() {
  return <BrowserRouter><Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>}><Routes>
    <Route path="/" element={<SessionLabPage />} />
    <Route path="/lab" element={<SessionLabPage />} />
    <Route path="/live" element={<SessionLivePage />} />
    <Route path="/setup" element={<ReadinessGatePage />} />
    <Route path="/setup/configure" element={<GuidedFirstConfigPage />} />
    <Route path="/admin/login" element={<LoginPage />} />
    <Route path="/admin/session-expired" element={<SessionExpiredPage />} />
    <Route element={<RequireAuth />}><Route path="/admin" element={<AdminShell />}>
      <Route index element={<OperatorHomePage />} />
      <Route path="sessions" element={<LiveSessionsPage />} />
      <Route path="sessions/:sessionId" element={<LiveSessionDetailPage />} />
      <Route path="profiles" element={<ProfilesListPage />} />
      <Route path="profiles/:profileId" element={<ProfileDetailPage />} />
      <Route path="profiles/:profileId/delete" element={<ProfileDeletePage />} />
      <Route path="scripts" element={<ScriptsLayout />}>
        <Route index element={<ScriptsIndexPage />} />
        <Route path="upload" element={<UploadScriptPage />} />
        <Route path="injections/new" element={<InjectionFlow />} />
        <Route path="injections/:index/edit" element={<InjectionFlow />} />
        <Route path="injections/:index/remove" element={<RemoveInjectionPage />} />
      </Route>
      <Route path="script-injection" element={<Navigate to="/admin/scripts?tab=injections" replace />} />
      <Route path="configurations" element={<ConfigurationsHubPage />} />
      <Route path="configurations/:section" element={<ConfigurationSectionPage />} />
      <Route path="host-resources" element={<HostResourcesPage />} />
      <Route path="host-resources/preview" element={<HostResourcesPage />} />
      <Route path="host-resources/apply" element={<HostResourcesPage />} />
      <Route path="diagnostics" element={<DiagnosticsHubPage />} />
      <Route path="diagnostics/health" element={<DiagnosticsHealthPage />} />
      <Route path="diagnostics/timeline" element={<DiagnosticsTimelinePage />} />
      <Route path="diagnostics/investigate" element={<DiagnosticsInvestigatePage />} />
      <Route path="diagnostics/governance" element={<DiagnosticsGovernancePage />} />
      <Route path="change-password" element={<ChangePasswordPage />} />
    </Route></Route>
    <Route path="*" element={<SessionLivePage />} />
  </Routes></Suspense></BrowserRouter>
}
