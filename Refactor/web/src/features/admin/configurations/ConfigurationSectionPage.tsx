import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { adminJson } from '@/lib/adminFetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  SaveFeedback,
  SaveFeedbackStrip,
} from '@/features/admin/components'
import { SectionPrimaryFields, type JsonObject } from './sectionEditors'

const editableSections = new Set([
  'Hosting',
  'Navigation',
  'Sessions',
  'ResourceManagement',
  'Scripting',
  'Journal',
  'Telemetry',
])

const numericLeaf = /bytes|count|sessions|percent|factor|points|width|height|interval|timeoutms|nofile|nproc/i

export function ConfigurationSectionPage() {
  const { section = '' } = useParams()
  const [value, setValue] = useState<JsonObject | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editableSections.has(section)) {
      setError('This configuration section is not available.')
      return
    }
    setValue(null)
    setError(null)
    setSaved(false)
    adminJson<JsonObject>(`/api/configurations/${section}`)
      .then((data) => setValue(data ?? {}))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load this section.'),
      )
  }, [section])

  const title = useMemo(() => section.replace(/([A-Z])/g, ' $1').trim(), [section])
  const description = useMemo(() => {
    switch (section) {
      case 'Navigation':
        return 'Set the default session target and which main-frame hosts are allowed.'
      case 'Hosting':
        return 'Configure domains, certificates, and optional DNS challenge credentials.'
      case 'Sessions':
        return 'How long sessions linger after disconnect, scripting bridge, starting viewport, and multi-client sharing.'
      case 'ResourceManagement':
        return 'Admission capacity, storage budget, and retention for this host.'
      case 'Telemetry':
        return 'Composite sampler cadence and which sample sections are included.'
      case 'Journal':
        return 'Opt-in non-canonical journal facts for deeper operational admission.'
      case 'Scripting':
        return 'Injection policy overview — routine edits belong in Scripts.'
      default:
        return 'Edit the operator controls for this engine section.'
    }
  }, [section])

  const replace = (next: JsonObject) => {
    setValue(next)
    setSaved(false)
  }

  const update = (path: string[], raw: string | boolean | number) => {
    if (!value) return
    const next = structuredClone(value)
    let target: JsonObject = next
    for (const key of path.slice(0, -1)) {
      const current = target[key]
      target[key] = current && typeof current === 'object' && !Array.isArray(current) ? structuredClone(current) : {}
      target = target[key] as JsonObject
    }
    const last = path.at(-1)!
    if (typeof raw === 'boolean' || typeof raw === 'number') {
      target[last] = raw
    } else if (numericLeaf.test(last) && raw.trim() !== '') {
      target[last] = Number(raw)
    } else {
      target[last] = raw
    }
    replace(next)
  }

  const save = async () => {
    if (!value) return
    setSaving(true)
    setError(null)
    try {
      await adminJson(`/api/configurations/${section}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
      setSaved(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this section.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !value) {
    return (
      <AdminPage width="editor">
        <PageHeader
          title={title || 'Configuration'}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/w7s/admin/configurations">
                <ArrowLeft className="h-4 w-4" />
                All sections
              </Link>
            </Button>
          }
        />
        <SaveFeedback mode="banner-error" message={error} />
      </AdminPage>
    )
  }

  if (!value) {
    return (
      <AdminPage width="editor">
        <PageHeader title={title || 'Configuration'} />
        <EmptyState title="Loading section" body="Retrieving the current engine settings." />
      </AdminPage>
    )
  }

  return (
    <AdminPage
      width="editor"
      footer={
        section === 'Scripting' ? undefined : (
          <SaveFeedbackStrip
            pending={saving}
            message={saved ? `${title} saved.` : null}
            error={error}
            onSave={save}
            saveLabel={`Save ${title}`}
          />
        )
      }
    >
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/w7s/admin/configurations">
              <ArrowLeft className="h-4 w-4" />
              All sections
            </Link>
          </Button>
        }
      />

      {section === 'Scripting' ? (
        <SectionPrimaryFields section={section} value={value} replace={replace} update={update} />
      ) : (
        <>
          <HelperCallout title="Why this matters">
            {section === 'Sessions'
              ? 'Pick a posture that matches how people use live sessions here, tune hold / bridge / data transport / viewport, then save. Advanced options stay collapsed.'
              : 'Changes apply to new sessions after save. Keep rare options collapsed until you need them.'}
          </HelperCallout>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {section === 'Sessions' ? 'Sessions posture' : `${title} controls`}
              </CardTitle>
              <CardDescription>
                {section === 'Sessions'
                  ? 'Start from a guided posture, then answer hold / bridge / data transport / viewport. Rare options stay collapsed.'
                  : 'Facilitated fields only — no JSON wall.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SectionPrimaryFields section={section} value={value} replace={replace} update={update} />
            </CardContent>
          </Card>
        </>
      )}
    </AdminPage>
  )
}
