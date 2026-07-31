import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { adminJson } from '@/lib/adminFetch'
import { ConfirmDestructive, PageHeader, SaveFeedback } from '@/features/admin/components'

export function ProfileDeletePage() {
  const { profileId = '' } = useParams()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setSubmitting(true); setError(null)
    try {
      await adminJson(`/api/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
      navigate('/admin/profiles', { replace: true, state: { message: 'Profile deleted' } })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to delete profile.'
      if (/live session/i.test(message)) { navigate(`/admin/profiles/${encodeURIComponent(profileId)}`, { replace: true, state: { message } }); return }
      setError(message)
    } finally { setSubmitting(false) }
  }
  return <div className="mx-auto max-w-2xl space-y-6">
    <PageHeader title="Delete profile" />
    <Card><CardHeader><CardTitle>Delete this profile permanently?</CardTitle><CardDescription>This removes persisted browser state for this identity. This cannot be undone.</CardDescription></CardHeader><CardContent><p className="font-mono text-sm">{profileId}</p>{error ? <div className="mt-4"><SaveFeedback mode="inline-error" message={error} /></div> : null}</CardContent></Card>
    <ConfirmDestructive open onOpenChange={(open) => { if (!open) navigate(`/admin/profiles/${encodeURIComponent(profileId)}`) }} title="Delete profile" body="This removes persisted browser state for this identity. This cannot be undone." confirmLabel="Delete permanently" onConfirm={remove} submitting={submitting} />
  </div>
}
