import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { adminJson } from '@/lib/adminFetch'
import {
  AdminPage,
  EmptyState,
  PageHeader,
  SaveFeedback,
  StepWizard,
} from '@/features/admin/components'
import { AppliedStep } from './AppliedStep'
import { HostResourcesStatusHero } from './HostResourcesStatusHero'
import { ParametersStep } from './ParametersStep'
import { ReviewStep } from './ReviewStep'
import {
  DEFAULT_PARAMS,
  fitParamsToHost,
  validateAgainstHost,
  type HostResourceApplyResult,
  type HostResourceProvisionParams,
  type HostResourceProvisionPlan,
  type HostResourceStatus,
} from './hostResourcesHelpers'

const PLAN_KEY = 'speculum.hostResources.plan'
const PARAMS_KEY = 'speculum.hostResources.params'
const RESULT_KEY = 'speculum.hostResources.result'

function stepFromPath(pathname: string): number {
  if (pathname.endsWith('/apply')) return 2
  if (pathname.endsWith('/preview')) return 1
  return 0
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function HostResourcesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [status, setStatus] = useState<HostResourceStatus | null>(null)
  const [params, setParams] = useState<HostResourceProvisionParams>(() => {
    const stored = readJson<HostResourceProvisionParams>(PARAMS_KEY)
    return stored ? { ...DEFAULT_PARAMS, ...stored } : DEFAULT_PARAMS
  })
  const [step, setStep] = useState(() => stepFromPath(location.pathname))
  const [plan, setPlan] = useState<HostResourceProvisionPlan | null>(() =>
    readJson<HostResourceProvisionPlan>(PLAN_KEY),
  )
  const [applyResult, setApplyResult] = useState<HostResourceApplyResult | null>(() =>
    readJson<HostResourceApplyResult>(RESULT_KEY),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const next = stepFromPath(location.pathname)
    if (next === 1 && !sessionStorage.getItem(PLAN_KEY) && !plan) {
      navigate('/w7s/admin/host-resources', { replace: true })
      setStep(0)
      return
    }
    if (next === 2 && !sessionStorage.getItem(RESULT_KEY) && !applyResult && !success) {
      navigate('/w7s/admin/host-resources', { replace: true })
      setStep(0)
      return
    }
    setStep(next)
  }, [location.pathname, navigate, plan, applyResult, success])

  const refresh = () =>
    adminJson<HostResourceStatus>('/api/admin/host-resources')
      .then(setStatus)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load host resource status.'),
      )

  useEffect(() => {
    void refresh()
  }, [])

  // If stored/default knobs cannot fit host *total* RAM, clamp floors once (never use free RAM).
  useEffect(() => {
    const total = status?.host?.memoryTotalBytes
    if (total == null || total <= 0) return
    if (validateAgainstHost(params, total) == null) return
    setParams((prev) => fitParamsToHost(prev, total))
  }, [status?.host?.memoryTotalBytes]) // eslint-disable-line react-hooks/exhaustive-deps -- fit once when host total arrives

  const goStep = (next: number) => {
    setStep(next)
    if (next === 0) navigate('/w7s/admin/host-resources')
    else if (next === 1) navigate('/w7s/admin/host-resources/preview')
    else navigate('/w7s/admin/host-resources/apply')
  }

  const preview = async () => {
    setPending(true)
    setError(null)
    try {
      const nextPlan = await adminJson<HostResourceProvisionPlan>('/api/admin/host-resources/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      setPlan(nextPlan)
      sessionStorage.setItem(PLAN_KEY, JSON.stringify(nextPlan))
      sessionStorage.setItem(PARAMS_KEY, JSON.stringify(params))
      setApplyResult(null)
      sessionStorage.removeItem(RESULT_KEY)
      setSuccess(null)
      goStep(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to preview this plan.')
    } finally {
      setPending(false)
    }
  }

  const apply = async () => {
    setPending(true)
    setError(null)
    try {
      const result = await adminJson<HostResourceApplyResult>('/api/admin/host-resources/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const message = `Applied at ${new Date(result.appliedAtUtc).toLocaleString()}. Shared memory target: ${(result.shmAppliedBytes / 1024 ** 3).toFixed(1)} GiB.`
      setSuccess(message)
      setApplyResult(result)
      sessionStorage.setItem(RESULT_KEY, JSON.stringify(result))
      sessionStorage.removeItem(PLAN_KEY)
      sessionStorage.removeItem(PARAMS_KEY)
      goStep(2)
      void refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to apply this plan.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AdminPage width="overview" className="space-y-6">
      <PageHeader
        title="Host resources"
        description="Plan shared memory and process limits, preview the computed budget, then apply a reviewed change."
      />
      {error ? <SaveFeedback mode="banner-error" message={error} /> : null}
      {!status ? (
        <EmptyState
          title="Loading host resources"
          body="Checking host capacity and the current sidecar allocation."
        />
      ) : (
        <HostResourcesStatusHero status={status} params={params} />
      )}
      <StepWizard
        steps={[
          { id: 'parameters', title: 'Parameters' },
          { id: 'review', title: 'Review' },
          { id: 'applied', title: 'Applied' },
        ]}
        currentIndex={step}
      />
      {step === 0 ? (
        <ParametersStep
          params={params}
          hostMemoryTotalBytes={status?.host?.memoryTotalBytes}
          onChange={(next) => {
            setParams(next)
            setSuccess(null)
            sessionStorage.setItem(PARAMS_KEY, JSON.stringify(next))
          }}
          onPreview={() => void preview()}
          pending={pending}
        />
      ) : null}
      {step === 1 && plan ? (
        <ReviewStep
          plan={plan}
          status={status}
          onBack={() => goStep(0)}
          onApply={() => void apply()}
          pending={pending}
        />
      ) : null}
      {step === 2 ? <AppliedStep result={applyResult} fallbackMessage={success} /> : null}
    </AdminPage>
  )
}
