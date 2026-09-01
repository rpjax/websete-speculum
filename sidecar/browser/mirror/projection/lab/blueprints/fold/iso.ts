/**
 * Shared iso fold — tree skip is explicit when the run has no DOM client.
 * When the run has a DOM client relay, skipped tree is a fail (PP-FR-1 / SEAL-DOM-P0-PROBE).
 */

import type { LabVerdict } from '../../dossier/types';

export type NodeNewConnectedProbe = {
  ok: boolean;
  checked: number;
  disconnectedIds: number[];
};

export type IsoJournal = {
  o2?: { identical: boolean; divergenceCount: number } | null;
  cssomO2?: { identical: boolean; divergenceCount: number } | null;
  table?: { identical: boolean | null; virtual?: { rowCount: number } | null };
  structuralDiff?: {
    identical: boolean;
    divergenceCount: number;
    divergences?: { kind: string }[];
  } | null;
  sequence?: number | null;
  skipped?: { id: string; reason: string }[];
  tableFailReason?: string | null;
  nodeNewConnected?: NodeNewConnectedProbe | null;
  cascade?: {
    virtual: {
      authorColor: string;
      adoptedColor: string;
      adoptedCount: number;
      styleSheetCount: number;
      styleElCount: number;
      doublePaint: boolean;
    } | null;
    client: {
      authorColor: string;
      adoptedColor: string;
      adoptedCount: number;
      styleSheetCount: number;
      styleElCount: number;
      doublePaint: boolean;
    } | null;
  } | null;
  formProps?: {
    virtual: { key: string; value?: string; checked?: boolean; selected?: boolean }[] | null;
    client: { key: string; value?: string; checked?: boolean; selected?: boolean }[] | null;
    identical: boolean | null;
    reason: string | null;
  };
  shadow?: { virtualHosts: number; clientHosts: number } | null;
  nested?: {
    virtualDocs: number;
    clientDocs: number;
    clientFrameHrefs: string[];
  } | null;
  contexts?: Record<
    number,
    {
      o2?: { identical: boolean; divergenceCount: number } | null;
      cssomO2?: { identical: boolean; divergenceCount: number } | null;
      table?: { identical: boolean | null };
      structuralDiff?: { identical: boolean; divergenceCount: number } | null;
      formProps?: { identical: boolean | null };
      nodeNewConnected?: NodeNewConnectedProbe | null;
      skipped?: { id: string; reason: string }[];
    }
  >;
  allPass?: boolean;
};

export function foldNodeNewConnected(
  probe: NodeNewConnectedProbe | null | undefined,
  opts?: { id?: string },
): LabVerdict {
  const id = opts?.id ?? 'probe.nodeNewConnected';
  if (!probe) {
    return { id, status: 'fail', reason: 'probe missing' };
  }
  if (!probe.ok) {
    return {
      id,
      status: 'fail',
      reason: `disconnected ids=[${probe.disconnectedIds.join(',')}] checked=${probe.checked}`,
    };
  }
  return {
    id,
    status: 'pass',
    reason: `checked=${probe.checked}`,
  };
}

/** Nested context vanished (typical after dropHost) — Virtual snapshot failed / no surface. */
export function isNestedContextGone(ctx: {
  skipped?: { id: string; reason: string }[];
  nodeNewConnected?: NodeNewConnectedProbe | null;
  table?: { identical: boolean | null };
  structuralDiff?: { identical: boolean; divergenceCount: number } | null;
}): boolean {
  const skipReason = (ctx.skipped ?? []).map((s) => s.reason).join(' ');
  if (/context_not_found|context not found|missing|no longer|unknown context/i.test(skipReason)) {
    return true;
  }
  return (
    ctx.nodeNewConnected == null &&
    ctx.table?.identical == null &&
    ctx.structuralDiff == null &&
    (ctx.skipped?.length ?? 0) > 0
  );
}

function colorLooksRed(c: string): boolean {
  return /rgb\(\s*255\s*,\s*0\s*,\s*0/.test(c) || c === 'red';
}

function colorLooksBlue(c: string): boolean {
  return /rgb\(\s*0\s*,\s*0\s*,\s*255/.test(c) || c === 'blue';
}

/** PP-CSSOM-A-2 — Virtual cascade always; Projected double-paint only with DOM client. */
export function foldCssomPaintBoundary(
  cascade: IsoJournal['cascade'] | null | undefined,
  opts?: { requireProjected?: boolean },
): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  const v = cascade?.virtual;
  if (!v) {
    verdicts.push({ id: 'cssom.double.virtual', status: 'fail', reason: 'cascade probe missing on Virtual' });
    return verdicts;
  }
  if (v.doublePaint) {
    verdicts.push({ id: 'cssom.double.virtual', status: 'fail', reason: 'Virtual doublePaint=true' });
  } else if (!colorLooksRed(v.authorColor) || !colorLooksBlue(v.adoptedColor)) {
    verdicts.push({
      id: 'cssom.double.virtual',
      status: 'fail',
      reason: `author=${v.authorColor} adopted=${v.adoptedColor} adoptedCount=${v.adoptedCount}`,
    });
  } else {
    verdicts.push({
      id: 'cssom.double.virtual',
      status: 'pass',
      reason: `author red, adopted blue, adoptedCount=${v.adoptedCount}`,
    });
  }

  const c = cascade?.client;
  if (!c) {
    verdicts.push({
      id: 'cssom.double.projected',
      status: opts?.requireProjected ? 'fail' : 'skipped',
      reason: opts?.requireProjected ? 'Projected cascade missing with DOM client' : 'no DOM client',
    });
    return verdicts;
  }
  if (c.doublePaint) {
    verdicts.push({
      id: 'cssom.double.projected',
      status: 'fail',
      reason: 'Projected adopted clone of author <style> (doublePaint)',
    });
  } else if (!colorLooksRed(c.authorColor) || !colorLooksBlue(c.adoptedColor)) {
    verdicts.push({
      id: 'cssom.double.projected',
      status: 'fail',
      reason: `author=${c.authorColor} adopted=${c.adoptedColor} adoptedCount=${c.adoptedCount}`,
    });
  } else {
    verdicts.push({
      id: 'cssom.double.projected',
      status: 'pass',
      reason: `author red, adopted blue, adoptedCount=${c.adoptedCount}`,
    });
  }
  return verdicts;
}

export function foldIsoJournal(
  iso: IsoJournal | null | undefined,
  opts?: { requireDomTree?: boolean },
): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  if (!iso) {
    verdicts.push({ id: 'iso', status: 'skipped', reason: 'iso journal missing' });
    return verdicts;
  }

  if (iso.o2) {
    verdicts.push({
      id: 'iso.dom',
      status: iso.o2.identical ? 'pass' : 'fail',
      reason: iso.o2.identical
        ? `identical at sequence ${iso.sequence}`
        : `${iso.o2.divergenceCount} O2 divergences`,
    });
  }
  if (iso.cssomO2) {
    verdicts.push({
      id: 'iso.cssom',
      status: iso.cssomO2.identical ? 'pass' : 'fail',
      reason: iso.cssomO2.identical
        ? `identical at sequence ${iso.sequence}`
        : `${iso.cssomO2.divergenceCount} CSSOM divergences`,
    });
  }
  if (iso.table?.identical === true) {
    verdicts.push({
      id: 'iso.table',
      status: 'pass',
      reason: `rowCount=${iso.table.virtual?.rowCount} hash match`,
    });
  } else if (iso.table?.identical === false) {
    verdicts.push({
      id: 'iso.table',
      status: 'fail',
      reason: iso.tableFailReason ?? 'table hash mismatch',
    });
  }
  if (iso.structuralDiff) {
    verdicts.push({
      id: 'iso.tree',
      status: iso.structuralDiff.identical ? 'pass' : 'fail',
      reason: iso.structuralDiff.identical
        ? 'identical'
        : `${iso.structuralDiff.divergenceCount} divergences`,
    });
  }
  if (iso.formProps?.identical === true) {
    verdicts.push({
      id: 'iso.formProps',
      status: 'pass',
      reason: iso.formProps.reason ?? 'form properties match',
    });
  } else if (iso.formProps?.identical === false) {
    verdicts.push({
      id: 'iso.formProps',
      status: 'fail',
      reason: iso.formProps.reason ?? 'form properties mismatch',
    });
  }
  const requireDomTree = opts?.requireDomTree === true;
  for (const s of iso.skipped ?? []) {
    const isTreeSkip = s.id === 'structuralDiff' || s.id === 'iso.tree' || s.id === 'tree';
    const isFormSkip = s.id === 'formProps' || s.id === 'iso.formProps';
    const id = isTreeSkip ? 'iso.tree' : s.id.startsWith('iso.') ? s.id : `iso.${s.id}`;
    const reason = isTreeSkip
      ? s.reason.includes('no lab client') || s.reason.includes('no DOM')
        ? 'iso.tree skipped: no DOM client'
        : s.reason
      : isFormSkip && (s.reason.includes('no lab client') || s.reason.includes('no DOM'))
        ? 'iso.formProps skipped: no DOM client'
        : s.reason;
    if (isTreeSkip && requireDomTree) {
      verdicts.push({
        id: 'iso.tree',
        status: 'fail',
        reason: `iso.tree skipped with DOM client: ${reason}`,
      });
    } else if (isFormSkip && requireDomTree) {
      verdicts.push({
        id: 'iso.formProps',
        status: 'fail',
        reason: `iso.formProps skipped with DOM client: ${reason}`,
      });
    } else {
      verdicts.push({ id, status: 'skipped', reason });
    }
  }
  const skippedTree = (iso.skipped ?? []).some(
    (s) => s.id === 'structuralDiff' || s.id === 'iso.tree' || s.id === 'tree',
  );
  if (!iso.structuralDiff && !skippedTree) {
    if (requireDomTree) {
      verdicts.push({
        id: 'iso.tree',
        status: 'fail',
        reason: 'iso.tree missing with DOM client',
      });
    } else {
      verdicts.push({
        id: 'iso.tree',
        status: 'skipped',
        reason: 'iso.tree skipped: no DOM client',
      });
    }
  }
  const skippedForm = (iso.skipped ?? []).some((s) => s.id === 'formProps' || s.id === 'iso.formProps');
  if (iso.formProps?.identical == null && !skippedForm) {
    if (requireDomTree) {
      verdicts.push({
        id: 'iso.formProps',
        status: 'fail',
        reason: 'iso.formProps missing with DOM client',
      });
    } else {
      verdicts.push({
        id: 'iso.formProps',
        status: 'skipped',
        reason: 'iso.formProps skipped: no DOM client',
      });
    }
  }
  verdicts.push(foldNodeNewConnected(iso.nodeNewConnected));

  if (iso.contexts) {
    for (const [id, ctx] of Object.entries(iso.contexts)) {
      const contextId = Number(id);
      const prefix = `iso.context.${id}`;
      // Last iso is often post-dropHost: nested ids stay in ContextIndex but Virtual is gone.
      if (contextId >= 2 && isNestedContextGone(ctx)) {
        verdicts.push({
          id: `${prefix}.gone`,
          status: 'skipped',
          reason: 'nested context absent (post-drop)',
        });
        continue;
      }
      if (ctx.o2) {
        verdicts.push({
          id: `${prefix}.dom`,
          status: ctx.o2.identical ? 'pass' : 'fail',
          reason: ctx.o2.identical ? 'identical' : `${ctx.o2.divergenceCount} O2 divergences`,
        });
      }
      if (ctx.cssomO2) {
        verdicts.push({
          id: `${prefix}.cssom`,
          status: ctx.cssomO2.identical ? 'pass' : 'fail',
          reason: ctx.cssomO2.identical ? 'identical' : `${ctx.cssomO2.divergenceCount} CSSOM divergences`,
        });
      }
      if (ctx.table?.identical === true) {
        verdicts.push({ id: `${prefix}.table`, status: 'pass', reason: 'hash match' });
      } else if (ctx.table?.identical === false) {
        verdicts.push({ id: `${prefix}.table`, status: 'fail', reason: 'table hash mismatch' });
      }
      if (ctx.structuralDiff) {
        verdicts.push({
          id: `${prefix}.tree`,
          status: ctx.structuralDiff.identical ? 'pass' : 'fail',
          reason: ctx.structuralDiff.identical ? 'identical' : `${ctx.structuralDiff.divergenceCount} divergences`,
        });
      }
      if (ctx.formProps?.identical === true) {
        verdicts.push({ id: `${prefix}.formProps`, status: 'pass', reason: 'form properties match' });
      } else if (ctx.formProps?.identical === false) {
        verdicts.push({ id: `${prefix}.formProps`, status: 'fail', reason: 'form properties mismatch' });
      }
      verdicts.push(
        foldNodeNewConnected(ctx.nodeNewConnected, {
          id: contextId === 1 ? 'probe.nodeNewConnected' : `${prefix}.probe.nodeNewConnected`,
        }),
      );
    }
  }

  return verdicts;
}
