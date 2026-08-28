import { describe, expect, it } from 'vitest'

/**
 * Documents the identity object MotorConnection sends on StartSessionAsync.
 * Server MsgPack must bind camelCase `clientToken` (see Api.Tests MsgPackHubContractTests).
 */
describe('StartSession identity shape (web contract)', () => {
  it('uses camelCase clientToken and correlationId keys', () => {
    const identity = {
      clientToken: 'abcdef0123456789abcdef0123456789',
      correlationId: 'actcorrelationid0000000000000001',
    }
    expect(Object.keys(identity).sort()).toEqual(['clientToken', 'correlationId'])
    expect(identity.clientToken).toHaveLength(32)
  })
})
