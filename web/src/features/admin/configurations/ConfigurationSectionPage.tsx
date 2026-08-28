import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { adminJson } from '@/lib/adminFetch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  MetaRow,
  PageHeader,
  SaveFeedback,
  SaveFeedbackStrip,
  StatusPill,
} from '@/features/admin/components'
import { SectionPrimaryFields, type JsonObject } from './sectionEditors'
import { sectionCanSave } from './sectionValidation'

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

function stableJson(value: JsonObject): string {
  return JSON.stringify(value)
}

export function ConfigurationSectionPage() {
  const { section = '' } = useParams()
  const [value, setValue] = useState<JsonObject | null>(null)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  /** Journal (and similar) can tighten canSave after async catalog load. */
  const [editorCanSave, setEditorCanSave] = useState(true)
  const loadGen = useRef(0)

  useEffect(() => {
    if (!editableSections.has(section)) {
      setError('This configuration section is not available.')
      setValue(null)
      setBaseline(null)
      return
    }
    const gen = ++loadGen.current
    setValue(null)
    setBaseline(null)
    setError(null)
    setSaved(false)
    setEditorCanSave(true)
    adminJson<JsonObject>(`/api/configurations/${section}`)
      .then((data) => {
        if (gen !== loadGen.current) return
        const next = data ?? {}
        setValue(next)
        setBaseline(stableJson(next))
      })
      .catch((reason: unknown) => {
        if (gen !== loadGen.current) return
        setError(reason instanceof Error ? reason.message : 'Unable to load this section.')
      })
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
        return 'Samples for Diagnostics charts, plus optional session event facts in the Journal.'
      case 'Journal':
        return 'Opt-in non-canonical journal facts for deeper operational admission.'
      case 'Scripting':
        return 'Injection policy overview — routine edits belong in Scripts.'
      default:
        return 'Edit the operator controls for this engine section.'
    }
  }, [section])

  const framing = useMemo(() => {
    switch (section) {
      case 'Sessions':
        return {
          calloutTitle: 'Why this matters' as string | null,
          callout:
            'Pick a posture that matches how people use live sessions here, tune hold / bridge / data transport / viewport, then save. Advanced options stay collapsed.' as string | null,
          cardTitle: 'Sessions posture',
          cardDescription:
            'Start from a guided posture, then answer hold / bridge / mirror / viewport. Rare options stay collapsed.',
        }
      default:
        return {
          calloutTitle: 'Why this matters' as string | null,
          callout:
            'Changes apply to new sessions after save. Rare options stay collapsed until you need them.' as string | null,
          cardTitle: `${title} controls`,
          cardDescription: 'Primary fields first — open Advanced only when you need it.',
        }
    }
  }, [section, title])

  const isDirty = Boolean(value && baseline != null && stableJson(value) !== baseline)
  const canSave = Boolean(value && sectionCanSave(section, value) && editorCanSave)
  const saveDisabled = !isDirty || !canSave || saving

  const stripMessage =
    saved && !isDirty
      ? `${title} saved.`
      : !canSave
        ? 'Fix validation errors before saving.'
        : !isDirty
          ? 'No unsaved changes.'
          : null
  const stripTone =
    saved && !isDirty ? 'success' : !canSave ? 'warning' : 'neutral'

  const replace = (next: JsonObject) => {
    setValue(next)
    setSaved(false)
    setError(null)
  }

  const update = (path: string[], raw: string | boolean | number) => {
    if (!value) return
    const next = structuredClone(value)
    let target: JsonObject = next
    for (const key of path.slice(0, -1)) {
      const current = target[key]
      target[key] =
        current && typeof current === 'object' && !Array.isArray(current) ? structuredClone(current) : {}
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
    if (!value || saveDisabled) return
    setSaving(true)
    setError(null)
    try {
      await adminJson(`/api/configurations/${section}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
      setBaseline(stableJson(value))
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
            disabled={saveDisabled}
            message={stripMessage}
            messageTone={stripTone}
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

      <MetaRow>
        <StatusPill
          label={isDirty ? 'Unsaved changes' : 'Up to date'}
          tone={isDirty ? 'warning' : 'success'}
        />
        {section !== 'Scripting' && (!canSave || isDirty) ? (
          <StatusPill
            label={canSave ? 'Ready to save' : 'Needs attention'}
            tone={canSave ? 'info' : 'warning'}
          />
        ) : null}
      </MetaRow>

      {section === 'Scripting' || section === 'Telemetry' ? (
        <SectionPrimaryFields
          section={section}
          value={value}
          replace={replace}
          update={update}
          onValidityChange={setEditorCanSave}
        />
      ) : (
        <>
          {framing.calloutTitle && framing.callout ? (
            <HelperCallout title={framing.calloutTitle}>{framing.callout}</HelperCallout>
          ) : null}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{framing.cardTitle}</CardTitle>
              <CardDescription>{framing.cardDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionPrimaryFields
                section={section}
                value={value}
                replace={replace}
                update={update}
                onValidityChange={setEditorCanSave}
              />
            </CardContent>
          </Card>
        </>
      )}
    </AdminPage>
  )
}
