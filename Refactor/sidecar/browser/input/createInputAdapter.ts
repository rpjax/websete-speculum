/**
 * Input adapter factory (Fase 2.3). Sole entry point sessions use to obtain an
 * {@link IInputAdapter} — replaces the direct `AbsOsInputStack.open(...)` call that used
 * to live inline in `PageProjectionBrowserSession.launch()`.
 *
 * Fase 2: only `'os-abs'` is registered (today's sealed default, zero behaviour change).
 * Fase 3 widens this to also accept `'sparse-cdp'` (opt-in only — never an env var, see
 * docs/page-projection/spec/decision-log.md 2026-08-27).
 */

import type { AbsOsInputOpenOptions } from './AbsOsInputStack';
import { openOsAbsInputAdapter } from './adapters/osAbsInputAdapter';
import { openSparseCdpInputAdapter, type SparseCdpInputOpenOptions } from './adapters/sparseCdpInputAdapter';
import type { IInputAdapter } from './ports';

export type InputAdapterKind = 'os-abs' | 'sparse-cdp';

export function createInputAdapter(kind: 'os-abs', opts: AbsOsInputOpenOptions): IInputAdapter;
export function createInputAdapter(kind: 'sparse-cdp', opts: SparseCdpInputOpenOptions): IInputAdapter;
export function createInputAdapter(
  kind: InputAdapterKind,
  opts: AbsOsInputOpenOptions | SparseCdpInputOpenOptions,
): IInputAdapter {
  if (kind === 'os-abs') {
    return openOsAbsInputAdapter(opts as AbsOsInputOpenOptions);
  }
  if (kind === 'sparse-cdp') {
    return openSparseCdpInputAdapter(opts as SparseCdpInputOpenOptions);
  }
  throw Object.assign(new Error(`unsupported input adapter kind: "${kind as string}"`), {
    code: 'FAILED_PRECONDITION',
    errorCode: 'input_adapter_kind_unsupported',
    phase: 'launch',
  });
}
