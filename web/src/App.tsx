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
import { MaintenancePage } from '@/features/admin/maintenance/MaintenancePage'
import { DiagnosticsHealthPage } from '@/features/admin/diagnostics/DiagnosticsHealthPage'
import NarrativeWorkspacePage from '@/features/admin/diagnostics/timeline/NarrativeWorkspacePage'
import { DiagnosticsInvestigatePage } from '@/features/admin/diagnostics/DiagnosticsInvestigatePage'
import { DiagnosticsGovernancePage } from '@/features/admin/diagnostics/DiagnosticsGovernancePage'
import { ResourcesPage } from '@/features/admin/diagnostics/resources/ResourcesPage'
import { ResourcesExplorePage } from '@/features/admin/diagnostics/resources/ResourcesExplorePage'
import { SignalsPage } from '@/features/admin/diagnostics/signals/SignalsPage'
import { ReportsPage } from '@/features/admin/diagnostics/reports/ReportsPage'
import { ReportDetailPage } from '@/features/admin/diagnostics/reports/ReportDetailPage'
import { ReportFlowPage } from '@/features/admin/diagnostics/reports/ReportFlowPage'
import { W7S_PREFIX } from '@/lib/w7s'

const SessionLabPage = lazy(() => import('@/features/sessions/lab/SessionLabPage'))
const SessionLivePage = lazy(() => import('@/features/sessions/live/SessionLivePage'))

export default function App() {
  return <BrowserRouter><Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>}><Routes>
    <Route path={`${W7S_PREFIX}/lab`} element={<SessionLabPage />} />
    <Route path={`${W7S_PREFIX}/setup`} element={<ReadinessGatePage />} />
    <Route path={`${W7S_PREFIX}/setup/configure`} element={<GuidedFirstConfigPage />} />
    <Route path={`${W7S_PREFIX}/admin/login`} element={<LoginPage />} />
    <Route path={`${W7S_PREFIX}/admin/session-expired`} element={<SessionExpiredPage />} />
    <Route element={<RequireAuth />}><Route path={`${W7S_PREFIX}/admin`} element={<AdminShell />}>
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
      <Route path="script-injection" element={<Navigate to={`${W7S_PREFIX}/admin/scripts?tab=injections`} replace />} />
      <Route path="configurations" element={<ConfigurationsHubPage />} />
      <Route path="configurations/:section" element={<ConfigurationSectionPage />} />
      <Route path="host-resources" element={<HostResourcesPage />} />
      <Route path="host-resources/preview" element={<HostResourcesPage />} />
      <Route path="host-resources/apply" element={<HostResourcesPage />} />
      <Route path="maintenance" element={<MaintenancePage />} />
      <Route path="diagnostics" element={<Navigate to={`${W7S_PREFIX}/admin/diagnostics/health`} replace />} />
      <Route path="diagnostics/health" element={<DiagnosticsHealthPage />} />
      <Route path="diagnostics/resources" element={<ResourcesPage />} />
      <Route path="diagnostics/resources/explore" element={<ResourcesExplorePage />} />
      <Route path="diagnostics/signals" element={<SignalsPage />} />
      <Route path="diagnostics/timeline" element={<NarrativeWorkspacePage />} />
      <Route path="diagnostics/investigate" element={<DiagnosticsInvestigatePage />} />
      <Route path="diagnostics/reports" element={<ReportsPage />} />
      <Route path="diagnostics/reports/new" element={<ReportFlowPage />} />
      <Route path="diagnostics/reports/:reportId" element={<ReportDetailPage />} />
      <Route path="diagnostics/governance" element={<DiagnosticsGovernancePage />} />
      <Route path="change-password" element={<ChangePasswordPage />} />
    </Route></Route>
    <Route path="*" element={<SessionLivePage />} />
  </Routes></Suspense></BrowserRouter>
}
