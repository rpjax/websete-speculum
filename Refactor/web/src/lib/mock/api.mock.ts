import type {
  ConfigStatus,
  SessionMeta,
  SessionDetail,
  ScriptListResponse,
  ScriptMeta,
  ConfigSectionName,
  ScriptingConfiguration,
  HostResourceStatus,
  HostResourceProvisionParams,
  HostResourceProvisionPlan,
  HostResourceApplyResult,
} from '@/lib/api'
import { ApiError } from '@/lib/errors'
import { delay } from './delay'
import {
  operationalStatus,
  sectionData,
  sessionsList,
  sessionDetail,
  scriptsList,
} from './fixtures'

let statusState: ConfigStatus = structuredClone(operationalStatus)
let sections: Record<string, unknown> = structuredClone(sectionData)
let sessions: SessionMeta[] = [...sessionsList]
let scripts: ScriptMeta[] = [...scriptsList]

export const mockApi = {
  getStatus: () => delay<ConfigStatus>(structuredClone(statusState)),

  getReady: () => delay(true),

  getClientConfig: () =>
    delay({
      schemaVersion: 1 as const,
      operational: statusState.operational,
      missing: [...statusState.missing],
      nsoParamName: '_w7s_nso',
      navigation: { defaultTargetHost: 'www.example.com' },
      sessions: {
        detachedSessionTimeoutSeconds: 300,
        dataStreamTransport: 'webTransport' as const,
        screencastMaxEncodeScale: 2,
      },
      resourceManagement: { maxConcurrentSessions: 8 },
      hosting: {
        required: false as const,
        domains: statusState.hosting?.domains ?? [],
      },
    }),

  getSection: <T = unknown>(section: ConfigSectionName | string): Promise<T> => {
    const data = sections[section]
    if (data === undefined) {
      return delay(null as T).then(() => {
        throw new ApiError('Section not found', 404)
      })
    }
    return delay(structuredClone(data) as T)
  },

  putSection: (section: ConfigSectionName | string, body: unknown) => {
    sections[section] = structuredClone(body)
    statusState.missing = statusState.missing.filter((s) => s !== section)
    if (statusState.missing.length === 0) statusState.operational = true
    return delay(undefined as void)
  },

  deleteSection: (section: ConfigSectionName | string) => {
    delete sections[section]
    if (!statusState.missing.includes(section)) statusState.missing.push(section)
    statusState.operational = false
    return delay(undefined as void)
  },

  get: <T = unknown>(path: string): Promise<T> => {
    if (path.includes('/openapi/')) return delay({ info: { title: 'Speculum Mock API', version: '0.0.0-mock' } } as T)
    return delay({} as T)
  },

  delete: (path: string) => {
    void path
    return delay(undefined as void)
  },

  listSessions: () => delay<SessionMeta[]>(structuredClone(sessions)),

  getSession: (sessionId: string) => delay<SessionDetail>(sessionDetail(sessionId)),

  deleteSession: (sessionId: string) => {
    sessions = sessions.filter((s) => s.sessionId !== sessionId)
    return delay(undefined as void)
  },

  listScripts: (query = '', skip = 0, take = 50) => {
    const normalized = query.trim().toLowerCase()
    const filtered = normalized
      ? scripts.filter((script) =>
          script.name.toLowerCase().includes(normalized)
          || script.id.toLowerCase().includes(normalized)
          || script.sha256.toLowerCase().includes(normalized),
        )
      : scripts
    const page: ScriptListResponse = {
      items: structuredClone(filtered.slice(skip, skip + take)),
      total: filtered.length,
    }
    return delay(page)
  },

  uploadScript: (_file: File, name?: string) => {
    const meta: ScriptMeta = {
      id: `scr-${Date.now()}`,
      name: name ?? _file.name,
      sha256: '0'.repeat(64),
      size: _file.size,
      uploadedAt: new Date().toISOString(),
    }
    scripts = [...scripts, meta]
    return delay(meta)
  },

  deleteScript: (id: string) => {
    scripts = scripts.filter((s) => s.id !== id)
    return delay(undefined as void)
  },

  getScripting: () =>
    delay<ScriptingConfiguration>(
      structuredClone((sections.Scripting as ScriptingConfiguration | undefined) ?? { injections: [] }),
    ),

  putScripting: (body: ScriptingConfiguration) => {
    sections.Scripting = structuredClone(body)
    return delay(undefined as void)
  },

  clearScripting: () => {
    sections.Scripting = { injections: [] }
    return delay(undefined as void)
  },

  getOpenApi: () => delay<unknown>({
    openapi: '3.0.3',
    info: { title: 'Speculum', version: '0.0.0-mock' },
    paths: {},
  }),

  getHostResources: () =>
    delay<HostResourceStatus>({
      host: {
        memoryTotalBytes: 16 * 1024 ** 3,
        memoryAvailableBytes: 10 * 1024 ** 3,
        cpuCount: 8,
        source: 'machine',
      },
      sidecar: {
        shmSizeBytes: 2 * 1024 ** 3,
      },
      lastApply: null,
      hostError: null,
    }),

  previewHostResources: (body: HostResourceProvisionParams) => {
    const hostTotal = 16 * 1024 ** 3
    const budget = body.maxRamBytes != null ? Math.min(hostTotal, body.maxRamBytes) : hostTotal
    const reservePct = body.reservePercent ?? 15
    const reserveMin = body.reserveMinBytes ?? 2 * 1024 ** 3
    const reserve = Math.max(reserveMin, Math.ceil(budget * (reservePct / 100)))
    const shmMin = body.shmMinBytes ?? 2 * 1024 ** 3
    const capPct = body.shmMaxPercentOfBudget ?? 75
    const cap = Math.floor(budget * (capPct / 100))
    const raw = Math.max(0, budget - reserve)
    const shmTargetBytes = Math.min(Math.max(raw, shmMin), Math.max(shmMin, cap))
    const plan: HostResourceProvisionPlan = {
      hostMemoryTotalBytes: hostTotal,
      hostCpuCount: 8,
      hostSource: 'machine',
      budgetBytes: budget,
      reserveBytes: reserve,
      shmTargetBytes,
      raiseUlimits: body.raiseUlimits ?? true,
      nofile: body.nofile ?? 1_048_576,
      nproc: body.nproc ?? 65_535,
      params: body,
    }
    return delay(plan)
  },

  applyHostResources: async (body: HostResourceProvisionParams) => {
    const plan = await mockApi.previewHostResources(body)
    const result: HostResourceApplyResult = {
      plan,
      shmBeforeBytes: 2 * 1024 ** 3,
      shmAppliedBytes: plan.shmTargetBytes,
      ulimitsRaised: plan.raiseUlimits,
      nofileApplied: plan.raiseUlimits ? plan.nofile : null,
      nprocApplied: plan.raiseUlimits ? plan.nproc : null,
      warnings: [],
      appliedAtUtc: new Date().toISOString(),
    }
    return delay(result)
  },
}

export function _resetMockApi() {
  statusState = structuredClone(operationalStatus)
  sections = structuredClone(sectionData)
  sessions = [...sessionsList]
  scripts = [...scriptsList]
}
