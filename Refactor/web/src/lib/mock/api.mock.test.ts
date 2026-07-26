import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, _resetMockApi } from './api.mock'
import { ApiError } from '@/lib/errors'

describe('mockApi', () => {
  beforeEach(() => {
    _resetMockApi()
  })

  it('getStatus returns operational status with hosting profiles', async () => {
    const status = await mockApi.getStatus()
    expect(status.operational).toBe(true)
    expect(status.missing).toEqual([])
    expect(status.hosting?.profiles.length).toBeGreaterThan(0)
    expect(status.hosting?.profiles[0].domain).toBeTruthy()
  })

  it('getReady returns true', async () => {
    expect(await mockApi.getReady()).toBe(true)
  })

  it('getSection returns typed section data', async () => {
    const forwarding = await mockApi.getSection<{ host: string; domains: string[] }>('Forwarding')
    expect(forwarding.host).toBe('www.example.com')
    expect(Array.isArray(forwarding.domains)).toBe(true)
  })

  it('getSection rejects with ApiError for missing section', async () => {
    await expect(mockApi.getSection('NonExistent')).rejects.toThrow(ApiError)
    try {
      await mockApi.getSection('NonExistent')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(404)
    }
  })

  it('putSection persists data and updates status', async () => {
    await mockApi.deleteSection('Forwarding')
    const afterDelete = await mockApi.getStatus()
    expect(afterDelete.missing).toContain('Forwarding')
    expect(afterDelete.operational).toBe(false)

    await mockApi.putSection('Forwarding', { host: 'new.example.com', domains: [] })
    const afterPut = await mockApi.getSection<{ host: string }>('Forwarding')
    expect(afterPut.host).toBe('new.example.com')

    const afterRestore = await mockApi.getStatus()
    expect(afterRestore.missing).not.toContain('Forwarding')
  })

  it('deleteSection removes section and marks non-operational', async () => {
    await mockApi.deleteSection('MaxSessions')
    const status = await mockApi.getStatus()
    expect(status.missing).toContain('MaxSessions')
    expect(status.operational).toBe(false)
  })

  it('listSessions returns session array', async () => {
    const sessions = await mockApi.listSessions()
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions[0].sessionId).toBeTruthy()
    expect(sessions[0].cookieCount).toBeGreaterThanOrEqual(0)
  })

  it('deleteSession removes from list', async () => {
    const before = await mockApi.listSessions()
    const target = before[0].sessionId
    await mockApi.deleteSession(target)
    const after = await mockApi.listSessions()
    expect(after.find((s) => s.sessionId === target)).toBeUndefined()
    expect(after.length).toBe(before.length - 1)
  })

  it('getSession returns detail with cookies and history', async () => {
    const sessions = await mockApi.listSessions()
    const detail = await mockApi.getSession(sessions[0].sessionId)
    expect(detail.sessionId).toBe(sessions[0].sessionId)
    expect(Array.isArray(detail.cookies)).toBe(true)
    expect(Array.isArray(detail.history)).toBe(true)
  })

  it('listScripts returns script array', async () => {
    const scripts = await mockApi.listScripts()
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts[0].id).toBeTruthy()
    expect(scripts[0].sha256).toHaveLength(64)
  })

  it('uploadScript adds to list', async () => {
    const before = await mockApi.listScripts()
    const file = new File(['console.log("hi")'], 'test.js', { type: 'text/javascript' })
    const meta = await mockApi.uploadScript(file, 'test-script.js')
    expect(meta.name).toBe('test-script.js')
    expect(meta.size).toBe(file.size)
    const after = await mockApi.listScripts()
    expect(after.length).toBe(before.length + 1)
  })

  it('deleteScript removes from list', async () => {
    const before = await mockApi.listScripts()
    const target = before[0].id
    await mockApi.deleteScript(target)
    const after = await mockApi.listScripts()
    expect(after.find((s) => s.id === target)).toBeUndefined()
  })

  it('_resetMockApi restores initial state', async () => {
    await mockApi.deleteSection('Forwarding')
    await mockApi.deleteSession((await mockApi.listSessions())[0].sessionId)
    _resetMockApi()
    const status = await mockApi.getStatus()
    expect(status.operational).toBe(true)
    expect(status.missing).toEqual([])
  })
})
