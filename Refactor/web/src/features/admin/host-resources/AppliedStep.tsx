import { HelperCallout, NextBestAction, StatusPill } from '@/features/admin/components'
import { formatGibLabel, type HostResourceApplyResult } from './hostResourcesHelpers'

export function AppliedStep({
  result,
  fallbackMessage,
}: {
  result: HostResourceApplyResult | null
  fallbackMessage?: string | null
}) {
  const when =
    result?.appliedAtUtc != null
      ? (() => {
          const parsed = new Date(result.appliedAtUtc)
          return Number.isNaN(parsed.valueOf()) ? result.appliedAtUtc : parsed.toLocaleString()
        })()
      : null

  return (
    <div className="space-y-5">
      <HelperCallout title="Resource plan applied">
        {when
          ? `Applied at ${when}. Shared memory target: ${formatGibLabel(result?.shmAppliedBytes)}.`
          : fallbackMessage ?? 'The latest plan has been applied.'}{' '}
        Review the status above before admitting additional sessions.
      </HelperCallout>

      {result ? (
        <div className="flex flex-wrap gap-2">
          <StatusPill label={`shm · ${formatGibLabel(result.shmAppliedBytes)}`} tone="success" />
          {result.shmBeforeBytes != null ? (
            <StatusPill label={`was · ${formatGibLabel(result.shmBeforeBytes)}`} tone="neutral" />
          ) : null}
          {result.ulimitsRaised != null ? (
            <StatusPill
              label={result.ulimitsRaised ? 'ulimits raised' : 'ulimits unchanged'}
              tone={result.ulimitsRaised ? 'info' : 'neutral'}
            />
          ) : null}
        </div>
      ) : null}

      {result?.warnings && result.warnings.length > 0 ? (
        <HelperCallout tone="warning" title="Apply warnings">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </HelperCallout>
      ) : null}

      <NextBestAction
        title="Tune admission next"
        body="Shared memory is provisioned. Set concurrent session slots and storage budget under Resource Management before admitting more load."
        ctaLabel="Open Resource Management"
        href="/admin/configurations/ResourceManagement"
      />

      <NextBestAction
        tone="warning"
        title="Admit sessions carefully"
        body="Refresh status above and confirm shm and host headroom look healthy before opening additional sessions on this host."
        ctaLabel="Back to parameters"
        href="/admin/host-resources"
      />
    </div>
  )
}
