/** Lab-compatible re-exports — prefer `@/features/sessions/debug/frontDebugLog`. */
export {
  describe,
  FRONT_DEBUG_LOG_LIMIT as LAB_LOG_LIMIT,
  type FrontDebugLogEntry as LabLogEntry,
  type FrontDebugLogLevel as LabLogLevel,
} from '@/features/sessions/debug/frontDebugLog'
