import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminApiError, adminJson } from '@/lib/adminFetch'
import { AdminPage, DataCard, EmptyState, HelperCallout, IdChip, MetaRow, PageHeader, StatCard, StatusPill } from '@/features/admin/components'

type ProfileDetail = { profileId: string; createdAt: string; lastUsedAt: string | null; cookieCount: number; localStorageCount: number; idbRecordCount: number; historyCount: number; hasLiveSession?: boolean }
type Session = { profileId: string }
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never'

export function ProfileDetailPage() {
  const { profileId = '' } = useParams()
  const [profile, setProfile] = useState<ProfileDetail | null>(null); const [live, setLive] = useState(false); const [notFound, setNotFound] = useState(false); const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => { setError(null); setNotFound(false); try { const data = await adminJson<ProfileDetail>(`/api/profiles/${encodeURIComponent(profileId)}`); setProfile(data); if (typeof data.hasLiveSession === 'boolean') setLive(data.hasLiveSession); else { const sessions = await adminJson<{ items: Session[] }>('/api/sessions'); setLive(sessions.items.some((session) => session.profileId === data.profileId)) } } catch (cause) { if (cause instanceof AdminApiError && cause.status === 404) setNotFound(true); else setError(cause instanceof Error ? cause.message : 'Unable to load profile.') } }, [profileId])
  useEffect(() => { load() }, [load])
  if (!profile && !notFound && !error) return <AdminPage width="editor"><Skeleton className="h-64 w-full" /></AdminPage>
  if (notFound) return <AdminPage width="editor"><EmptyState title="Profile not found" body="This persisted browser identity is no longer available." cta={{ label: 'Back to profiles', href: '/w7s/admin/profiles' }} /></AdminPage>
  if (error) return <AdminPage width="editor"><HelperCallout tone="danger" title="Profile unavailable">{error}<Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Retry</Button></HelperCallout></AdminPage>
  if (!profile) return null
  const counts = [['Cookies', profile.cookieCount], ['Local storage', profile.localStorageCount], ['IndexedDB records', profile.idbRecordCount], ['History entries', profile.historyCount]]
  return <AdminPage width="editor" className="space-y-6">
    <PageHeader title="Profile" description="Persisted browser identity and state summary." actions={<Button asChild variant="destructive" disabled={live}><Link to={`/w7s/admin/profiles/${encodeURIComponent(profile.profileId)}/delete`}>Delete profile</Link></Button>} />
    <DataCard className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-muted-foreground">Profile</p><IdChip id={profile.profileId} /></div><MetaRow><StatusPill label={live ? 'Live session attached' : 'No live session'} tone={live ? 'warning' : 'success'} /></MetaRow></div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-muted-foreground">Created</p><p className="mt-1">{date(profile.createdAt)}</p></div><div><p className="text-muted-foreground">Last used</p><p className="mt-1">{date(profile.lastUsedAt)}</p></div></div></DataCard>
    {live ? <HelperCallout tone="warning" title="This profile has a live session. Stop the session before deleting." action={{ label: 'View sessions', href: '/w7s/admin/sessions' }}>Deletion is unavailable while this identity is live.</HelperCallout> : null}
    <section><h2 className="mb-3 text-lg font-semibold">State summary</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{counts.map(([label, count]) => <StatCard key={String(label)} label={String(label)} value={Number(count)} />)}</div></section>
    <Link className="inline-block text-sm underline" to="/w7s/admin/profiles">Back to profiles</Link>
  </AdminPage>
}
