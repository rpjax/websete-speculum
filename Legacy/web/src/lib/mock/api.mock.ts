import type { ConfigStatus, SessionMeta, SessionDetail, ScriptMeta, ConfigSectionName } from '@/lib/api'
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

  listScripts: () => delay<ScriptMeta[]>(structuredClone(scripts)),

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

  getOpenApi: () => delay<unknown>({
    openapi: '3.0.3',
    info: { title: 'Speculum', version: '0.0.0-mock' },
    paths: {},
  }),
}

export function _resetMockApi() {
  statusState = structuredClone(operationalStatus)
  sections = structuredClone(sectionData)
  sessions = [...sessionsList]
  scripts = [...scriptsList]
}
