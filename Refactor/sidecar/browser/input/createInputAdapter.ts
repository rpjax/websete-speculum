/**
 * PageProjection input adapter factory — sparse-cdp only.
 * OS ABS (`os-abs`) was removed from the codebase (decision-log.md 2026-08-27).
 */

import { openSparseCdpInputAdapter, type SparseCdpInputOpenOptions } from './adapters/sparseCdpInputAdapter';
import type { IInputAdapter } from './ports';

export type InputAdapterKind = 'sparse-cdp';

export function createInputAdapter(kind: 'sparse-cdp', opts: SparseCdpInputOpenOptions): IInputAdapter;
export function createInputAdapter(kind: InputAdapterKind, opts: SparseCdpInputOpenOptions): IInputAdapter {
  if (kind === 'sparse-cdp') {
    return openSparseCdpInputAdapter(opts);
  }
  throw Object.assign(new Error(`unsupported input adapter kind: "${kind as string}"`), {
    code: 'FAILED_PRECONDITION',
    errorCode: 'input_adapter_kind_unsupported',
    phase: 'launch',
  });
}
