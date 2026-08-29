/**
 * CSSOM sheet dump — styleSheets + adoptedStyleSheets with cross-origin catch.
 * Lab diagnostic; runs in-page (Virtual evaluate or Projected client).
 */

export type CssomSheetDumpEntry = {
  href: string | null;
  ownerNode: string | null;
  dataClass: string | null;
  ruleCount: number;
  rules: string[] | '<<CROSS-ORIGIN>>' | '<<ERROR>>';
  adopted: boolean;
  scope: 'document' | 'shadow';
  shadowHostId?: string | null;
};

export type CssomSheetDumpResult = {
  ok: boolean;
  reason?: string;
  documentUrl?: string;
  entries: CssomSheetDumpEntry[];
  styleSheetCount: number;
  adoptedCount: number;
  totalRules: number;
};

/** In-page dump script body — paste into evaluate or client harness. */
export const CSSOM_SHEET_DUMP_EXPR = `(() => {
  function dumpSheetList(list, scope, hostId) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s) continue;
      let rules = '<<ERROR>>';
      let ruleCount = 0;
      try {
        const arr = [];
        for (let j = 0; j < s.cssRules.length; j++) arr.push(s.cssRules[j].cssText);
        rules = arr;
        ruleCount = arr.length;
      } catch {
        rules = '<<CROSS-ORIGIN>>';
      }
      const owner = s.ownerNode;
      const dataClass =
        owner && owner.dataset && owner.dataset.class ? String(owner.dataset.class) : null;
      out.push({
        href: s.href || null,
        ownerNode: owner ? owner.tagName + (owner.id ? '#' + owner.id : '') : null,
        dataClass,
        ruleCount,
        rules,
        adopted: scope === 'shadow' || !owner,
        scope,
        shadowHostId: hostId || null,
      });
    }
    return out;
  }
  function collectShadowSheets(root, hostEl) {
    const hostId = hostEl.id || hostEl.tagName.toLowerCase();
    const out = [];
    try {
      out.push(...dumpSheetList(root.adoptedStyleSheets || [], 'shadow', hostId));
    } catch {}
    const queue = [root];
    while (queue.length) {
      const n = queue.shift();
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const el = c;
        if (el.shadowRoot) {
          out.push(...dumpSheetList(el.shadowRoot.adoptedStyleSheets || [], 'shadow', el.id || el.tagName));
          queue.push(el.shadowRoot);
        }
        queue.push(el);
      }
    }
    return out;
  }
  const entries = dumpSheetList(document.styleSheets, 'document', null);
  const closedFixture = globalThis.__speculumClosedRoot;
  if (closedFixture) {
    try {
      entries.push(...dumpSheetList(closedFixture.styleSheets, 'shadow', 'shadow-host'));
    } catch {}
    try {
      entries.push(...dumpSheetList(closedFixture.adoptedStyleSheets || [], 'shadow', 'shadow-host'));
    } catch {}
  }
  const hosts = document.querySelectorAll('*');
  for (const h of hosts) {
    const sr = h.shadowRoot || (globalThis.__speculumResolveShadowRoot ? globalThis.__speculumResolveShadowRoot(h) : null);
    if (sr) entries.push(...collectShadowSheets(sr, h));
  }
  let totalRules = 0;
  for (const e of entries) {
    if (Array.isArray(e.rules)) totalRules += e.rules.length;
  }
  return JSON.stringify({
    ok: true,
    documentUrl: document.URL,
    entries,
    styleSheetCount: entries.filter((e) => !e.adopted).length,
    adoptedCount: entries.filter((e) => e.adopted).length,
    totalRules,
  });
})()`;

export function parseCssomSheetDump(raw: unknown): CssomSheetDumpResult {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid_json', entries: [], styleSheetCount: 0, adoptedCount: 0, totalRules: 0 };
    }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'empty', entries: [], styleSheetCount: 0, adoptedCount: 0, totalRules: 0 };
  }
  const o = raw as CssomSheetDumpResult;
  return {
    ok: o.ok === true,
    reason: o.reason,
    documentUrl: o.documentUrl,
    entries: Array.isArray(o.entries) ? o.entries : [],
    styleSheetCount: typeof o.styleSheetCount === 'number' ? o.styleSheetCount : 0,
    adoptedCount: typeof o.adoptedCount === 'number' ? o.adoptedCount : 0,
    totalRules: typeof o.totalRules === 'number' ? o.totalRules : 0,
  };
}

export type SheetClassVerdict = { ok: boolean; note: string };

export type SheetCompareResult = {
  identical: boolean;
  notes: string[];
  class9a: SheetClassVerdict;
  class9b: SheetClassVerdict;
};

const CLASS9A_MARKERS = ['9a', 'xo-no-cors'];
const CLASS9B_MARKERS = ['9b', 'xo-cors'];

function entryMatchesClass(entry: CssomSheetDumpEntry, markers: string[]): boolean {
  const dc = entry.dataClass ?? '';
  if (markers.some((m) => dc === m || dc.includes(m))) return true;
  const href = entry.href ?? '';
  return markers.some((m) => href.includes(m));
}

export function findSheetEntryByClass(
  entries: CssomSheetDumpEntry[],
  classId: '9a' | '9b',
): CssomSheetDumpEntry | undefined {
  const markers = classId === '9a' ? CLASS9A_MARKERS : CLASS9B_MARKERS;
  return entries.find((e) => entryMatchesClass(e, markers));
}

export function verifyClass9a(entry: CssomSheetDumpEntry | undefined): SheetClassVerdict {
  if (!entry) return { ok: false, note: 'missing 9a sheet entry' };
  if (entry.rules !== '<<CROSS-ORIGIN>>') {
    return { ok: false, note: `9a expected <<CROSS-ORIGIN>> got ${String(entry.rules).slice(0, 40)}` };
  }
  return { ok: true, note: '9a cross-origin blocked (SecurityError)' };
}

export function verifyClass9b(entry: CssomSheetDumpEntry | undefined): SheetClassVerdict {
  if (!entry) return { ok: false, note: 'missing 9b sheet entry' };
  if (entry.rules === '<<CROSS-ORIGIN>>') return { ok: false, note: '9b expected readable rules' };
  if (!Array.isArray(entry.rules) || entry.rules.length === 0) {
    return { ok: false, note: '9b has no readable rules' };
  }
  return { ok: true, note: `9b ${entry.ruleCount} rules readable` };
}

function compareEntryRules(
  v: CssomSheetDumpEntry,
  p: CssomSheetDumpEntry,
  label: string,
  notes: string[],
): void {
  if (v.href && p.href && !p.href.includes('virtual-asset') && v.href !== p.href) {
    notes.push(`${label} href virtual=${v.href} projected=${p.href}`);
  }
  if (Array.isArray(v.rules) && Array.isArray(p.rules)) {
    if (v.ruleCount !== p.ruleCount) {
      notes.push(`${label} ruleCount virtual=${v.ruleCount} projected=${p.ruleCount}`);
    }
    const vText = v.rules.join('\n');
    const pText = p.rules.join('\n');
    if (vText !== pText) notes.push(`${label} rule text diverged`);
  } else if (v.rules !== p.rules) {
    notes.push(`${label} rules virtual=${String(v.rules)} projected=${String(p.rules)}`);
  }
}

export function compareSheetDumps(
  virtual: CssomSheetDumpResult,
  projected: CssomSheetDumpResult,
): SheetCompareResult {
  const notes: string[] = [];
  const class9aV = findSheetEntryByClass(virtual.entries, '9a');
  const class9bV = findSheetEntryByClass(virtual.entries, '9b');
  const class9a = verifyClass9a(class9aV);
  const class9b = verifyClass9b(class9bV);

  if (!virtual.ok) notes.push(`virtualOk=false reason=${virtual.reason ?? '?'}`);
  if (!projected.ok) notes.push(`projectedOk=false reason=${projected.reason ?? '?'}`);

  if (virtual.ok && projected.ok) {
    if (virtual.totalRules !== projected.totalRules) {
      notes.push(`totalRules virtual=${virtual.totalRules} projected=${projected.totalRules}`);
    }
    if (virtual.styleSheetCount !== projected.styleSheetCount) {
      notes.push(`styleSheetCount virtual=${virtual.styleSheetCount} projected=${projected.styleSheetCount}`);
    }
    if (virtual.adoptedCount !== projected.adoptedCount) {
      notes.push(`adoptedCount virtual=${virtual.adoptedCount} projected=${projected.adoptedCount}`);
    }

    const class9aP = findSheetEntryByClass(projected.entries, '9a');
    const class9bP = findSheetEntryByClass(projected.entries, '9b');
    const p9a = verifyClass9a(class9aP);
    const p9b = verifyClass9b(class9bP);
    if (!p9a.ok) notes.push(`projected 9a: ${p9a.note}`);
    if (!p9b.ok) notes.push(`projected 9b: ${p9b.note}`);
    if (class9aV && class9aP) compareEntryRules(class9aV, class9aP, '9a', notes);
    if (class9bV && class9bP) compareEntryRules(class9bV, class9bP, '9b', notes);

    for (const entry of virtual.entries) {
      const dc = entry.dataClass;
      if (!dc || dc === '9a' || dc === '9b') continue;
      const pMatch = projected.entries.find(
        (e) => e.dataClass === dc || (entry.href && e.href === entry.href),
      );
      if (!pMatch) {
        notes.push(`missing on projected class=${dc} href=${entry.href ?? '?'}`);
        continue;
      }
      compareEntryRules(entry, pMatch, `class${dc}`, notes);
    }
  }

  const identical =
    notes.length === 0 && class9a.ok && class9b.ok && virtual.ok && projected.ok;
  return { identical, notes, class9a, class9b };
}
