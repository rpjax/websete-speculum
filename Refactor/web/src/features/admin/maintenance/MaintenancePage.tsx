import { useCallback, useEffect, useState } from 'react'
import { Database, FolderClock, ScrollText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { adminJson } from '@/lib/adminFetch'
import { useAdminToast } from '@/features/admin/shell/AdminToastContext'
import {
  AdminPage,
  ConfirmDestructive,
  DataCard,
  HelperCallout,
  PageHeader,
  StatCard,
} from '@/features/admin/components'

type MaintenanceSummary = {
  endedSessionsCount: number
  independentJournalFactsCount: number
  inactiveProfilesCount: number
}

type MaintenanceDeletionResult = {
  sessionsDeleted: number
  journalFactsDeleted: number
  profilesDeleted: number
}

type PendingAction = 'endedSessions' | 'independentFacts' | 'inactiveProfiles' | null

/** Days → an ISO cutoff instant in the past, or null when the field is blank ("no bound"). */
function daysToCutoffIso(days: string): string | null {
  const parsed = Number(days)
  if (!days.trim() || !Number.isFinite(parsed) || parsed < 0) return null
  return new Date(Date.now() - parsed * 24 * 60 * 60 * 1000).toISOString()
}

export function MaintenancePage() {
  const toast = useAdminToast()
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)

  const [endedBeforeDays, setEndedBeforeDays] = useState('')
  const [endedTake, setEndedTake] = useState('100')

  const [factsType, setFactsType] = useState('')
  const [factsOlderThanDays, setFactsOlderThanDays] = useState('')

  const [profilesOlderThanDays, setProfilesOlderThanDays] = useState('30')
  const [profilesTake, setProfilesTake] = useState('100')

  const load = useCallback(() => {
    setError(null)
    adminJson<MaintenanceSummary>('/api/admin/maintenance/summary')
      .then(setSummary)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load cleanup candidates.'))
  }, [])
  useEffect(load, [load])

  const runDeleteEndedSessions = async () => {
    try {
      const result = await adminJson<MaintenanceDeletionResult>('/api/admin/maintenance/sessions/delete-ended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endedBefore: daysToCutoffIso(endedBeforeDays),
          take: Number(endedTake) || 100,
        }),
      })
      toast.success(
        `Deleted ${result.sessionsDeleted} session(s) and ${result.journalFactsDeleted} cascaded journal fact(s).`,
      )
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to delete ended sessions.')
    } finally {
      setPending(null)
    }
  }

  const runDeleteIndependentFacts = async () => {
    try {
      const result = await adminJson<MaintenanceDeletionResult>('/api/admin/maintenance/journal/delete-independent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: factsType.trim() || null,
          olderThan: daysToCutoffIso(factsOlderThanDays),
        }),
      })
      toast.success(`Deleted ${result.journalFactsDeleted} independent journal fact(s).`)
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to delete independent journal facts.')
    } finally {
      setPending(null)
    }
  }

  const runDeleteInactiveProfiles = async () => {
    try {
      const cutoff = daysToCutoffIso(profilesOlderThanDays) ?? new Date(0).toISOString()
      const result = await adminJson<MaintenanceDeletionResult>('/api/admin/maintenance/profiles/delete-inactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThan: cutoff, take: Number(profilesTake) || 100 }),
      })
      toast.success(`Deleted ${result.profilesDeleted} inactive profile(s).`)
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to delete inactive profiles.')
    } finally {
      setPending(null)
    }
  }

  return (
    <AdminPage width="overview" className="space-y-4">
      <PageHeader
        title="Maintenance"
        description="Manual cleanup. Every deletion here goes through the same engine choke point — deleting a session always cascades its journal facts, and facts tied to a session can never be removed on their own."
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <HelperCallout tone="danger" title="Cleanup candidates unavailable">
          {error}
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </HelperCallout>
      ) : null}

      {!summary && !error ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : null}

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Ended sessions" value={summary.endedSessionsCount} icon={<FolderClock className="h-4 w-4" />} />
          <StatCard
            label="Independent journal facts"
            value={summary.independentJournalFactsCount}
            icon={<ScrollText className="h-4 w-4" />}
          />
          <StatCard
            label="Inactive profiles (24h+)"
            value={summary.inactiveProfilesCount}
            icon={<Database className="h-4 w-4" />}
          />
        </div>
      ) : null}

      <DataCard className="space-y-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Trash2 className="h-4 w-4" /> Delete ended sessions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Removes Stopped/Aborted session rows and cascades every journal fact tied to them. Live sessions are
            never touched.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Only sessions ended more than N days ago (blank = all)</Label>
            <Input
              type="number"
              min={0}
              placeholder="e.g. 7"
              value={endedBeforeDays}
              onChange={(event) => setEndedBeforeDays(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Max sessions to process</Label>
            <Input type="number" min={1} value={endedTake} onChange={(event) => setEndedTake(event.target.value)} />
          </div>
        </div>
        <Button variant="destructive" onClick={() => setPending('endedSessions')}>
          Delete ended sessions
        </Button>
      </DataCard>

      <DataCard className="space-y-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Trash2 className="h-4 w-4" /> Delete independent journal facts
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only removes facts that carry no session association — facts tied to a session can only be removed by
            deleting that session.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fact type (blank = all types)</Label>
            <Input
              placeholder="e.g. ResourceSample"
              value={factsType}
              onChange={(event) => setFactsType(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Only facts older than N days (blank = no age bound)</Label>
            <Input
              type="number"
              min={0}
              placeholder="e.g. 30"
              value={factsOlderThanDays}
              onChange={(event) => setFactsOlderThanDays(event.target.value)}
            />
          </div>
        </div>
        <Button variant="destructive" onClick={() => setPending('independentFacts')}>
          Delete independent facts
        </Button>
      </DataCard>

      <DataCard className="space-y-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Trash2 className="h-4 w-4" /> Delete inactive profiles
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manually runs the same inactive-profile sweep the retention background job performs. Profiles with a
            live session are never touched.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Idle for more than N days</Label>
            <Input
              type="number"
              min={0}
              value={profilesOlderThanDays}
              onChange={(event) => setProfilesOlderThanDays(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Max profiles to process</Label>
            <Input type="number" min={1} value={profilesTake} onChange={(event) => setProfilesTake(event.target.value)} />
          </div>
        </div>
        <Button variant="destructive" onClick={() => setPending('inactiveProfiles')}>
          Delete inactive profiles
        </Button>
      </DataCard>

      <ConfirmDestructive
        open={pending === 'endedSessions'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Delete ended sessions?"
        body="This permanently deletes matching session rows and every journal fact cascaded from them. This cannot be undone."
        confirmLabel="Delete sessions"
        onConfirm={() => void runDeleteEndedSessions()}
      />
      <ConfirmDestructive
        open={pending === 'independentFacts'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Delete independent journal facts?"
        body="This permanently deletes matching facts that are not associated with any session. This cannot be undone."
        confirmLabel="Delete facts"
        onConfirm={() => void runDeleteIndependentFacts()}
      />
      <ConfirmDestructive
        open={pending === 'inactiveProfiles'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Delete inactive profiles?"
        body="This permanently deletes matching profiles and their persisted browser state. This cannot be undone."
        confirmLabel="Delete profiles"
        onConfirm={() => void runDeleteInactiveProfiles()}
      />
    </AdminPage>
  )
}
