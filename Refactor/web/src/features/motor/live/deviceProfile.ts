/**
 * Thin re-export — Sessions owns device/viewport live helpers.
 * MotorEngine keeps importing from this path.
 */
export {
  DEFAULT_VIEWPORT_POLICY,
  SESSION_VIEWPORT_BASELINE,
  detectDeviceProfile,
  deviceProfilesEqual,
  isTouchPrimaryProfile,
  normalizeSessionViewport,
  validateResizeViewport,
  type DeviceProfilePayload,
  type SessionViewportBounds,
} from '@/features/sessions/live/deviceProfile'
