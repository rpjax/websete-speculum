import { describe, it, expect } from 'vitest'
import { ApiError } from './errors'

describe('ApiError', () => {
  it('sets name to ApiError', () => {
    const err = new ApiError('Not found', 404)
    expect(err.name).toBe('ApiError')
  })

  it('preserves message and status', () => {
    const err = new ApiError('Forbidden', 403)
    expect(err.message).toBe('Forbidden')
    expect(err.status).toBe(403)
  })

  it('is an instance of Error', () => {
    const err = new ApiError('test', 500)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
  })

  it('stores optional body', () => {
    const body = { detail: 'invalid key', code: 'AUTH_FAILED' }
    const err = new ApiError('Unauthorized', 401, body)
    expect(err.body).toEqual(body)
  })

  it('body is undefined when not provided', () => {
    const err = new ApiError('Server error', 500)
    expect(err.body).toBeUndefined()
  })
})
