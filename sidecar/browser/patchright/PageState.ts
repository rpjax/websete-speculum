import type { CDPSession, Page } from 'patchright';
import type {
  BrowserCookieState,
  BrowserHistoryState,
  BrowserIdbRecordState,
  BrowserState,
} from '../BrowserSession';

type CdpCookieParam = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

const CDP_SAME_SITE: Record<string, 'Strict' | 'Lax' | 'None'> = {
  strict: 'Strict',
  lax: 'Lax',
  none: 'None',
};

const EPOCH_MS_THRESHOLD = 9_999_999_999;

/** Counts from cookie sanitize + CDP apply (tolerant restore). */
export type CookieNormalizeStats = {
  total: number;
  skipped: number;
  normalized: number;
  applied: number;
  failedIndividual: number;
};

export function emptyCookieNormalizeStats(total = 0): CookieNormalizeStats {
  return { total, skipped: 0, normalized: 0, applied: 0, failedIndividual: 0 };
}

type SanitizeResult = { cookie: CdpCookieParam; normalized: boolean } | null;

/**
 * Tolerant CDP cookie shape: drop empty names, omit non-positive expires /
 * unknown SameSite, ms→s conversion, SameSite=None forces secure.
 */
export function sanitizeCookieForCdp(c: BrowserCookieState): CdpCookieParam | null {
  return sanitizeCookieDetailed(c)?.cookie ?? null;
}

function sanitizeCookieDetailed(c: BrowserCookieState): SanitizeResult {
  if (!c.name?.trim()) return null;
  let normalized = false;
  const trimmedName = c.name.trim();
  if (trimmedName !== c.name) normalized = true;

  const cookie: CdpCookieParam = {
    name: trimmedName,
    value: c.value ?? '',
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
  };

  if (c.domain?.trim()) {
    const domain = c.domain.trim();
    cookie.domain = domain;
    if (domain !== c.domain) normalized = true;
  } else if (c.domain) {
    normalized = true; // empty/whitespace domain omitted
  }

  if (c.path?.trim()) cookie.path = c.path;

  if (typeof c.expires === 'number' && c.expires > 0) {
    if (c.expires > EPOCH_MS_THRESHOLD) {
      cookie.expires = Math.round(c.expires / 1000);
      normalized = true;
    } else {
      cookie.expires = c.expires;
    }
  } else if (typeof c.expires === 'number') {
    normalized = true; // non-positive expires omitted
  }

  if (c.sameSite?.trim()) {
    const mapped = CDP_SAME_SITE[c.sameSite.trim().toLowerCase()];
    if (mapped) {
      cookie.sameSite = mapped;
      if (mapped !== c.sameSite) normalized = true;
      if (mapped === 'None' && !cookie.secure) {
        cookie.secure = true;
        normalized = true;
      }
    } else {
      normalized = true; // unrecognized sameSite omitted
    }
  } else if (c.sameSite != null && c.sameSite !== '') {
    normalized = true;
  }

  return { cookie, normalized };
}

export function sanitizeCookieBatch(cookies: readonly BrowserCookieState[]): {
  valid: CdpCookieParam[];
  skippedCount: number;
  normalizedCount: number;
} {
  const valid: CdpCookieParam[] = [];
  let skippedCount = 0;
  let normalizedCount = 0;
  for (const c of cookies) {
    const result = sanitizeCookieDetailed(c);
    if (!result) {
      skippedCount++;
      continue;
    }
    if (result.normalized) normalizedCount++;
    valid.push(result.cookie);
  }
  return { valid, skippedCount, normalizedCount };
}

export class PageState {
  async export(cdp: CDPSession, page: Page): Promise<BrowserState> {
    const cookies = await this.exportCookies(cdp);
    const localStorage = await this.exportLocalStorage(page);
    const idbRecords = await this.exportIndexedDb(cdp, page);
    const history = await this.exportHistory(cdp, page);
    return { cookies, localStorage, idbRecords, history };
  }

  async restore(cdp: CDPSession, page: Page, state: BrowserState): Promise<CookieNormalizeStats> {
    const { valid, skippedCount, normalizedCount } = sanitizeCookieBatch(state.cookies);
    const stats: CookieNormalizeStats = {
      total: state.cookies.length,
      skipped: skippedCount,
      normalized: normalizedCount,
      applied: 0,
      failedIndividual: 0,
    };

    if (valid.length > 0) {
      try {
        await cdp.send('Network.setCookies', { cookies: valid });
        stats.applied = valid.length;
      } catch {
        for (const cookie of valid) {
          try {
            await cdp.send('Network.setCookies', { cookies: [cookie] });
            stats.applied++;
          } catch {
            stats.failedIndividual++;
          }
        }
      }
    }

    await this.importLocalStorage(page, state);
    await this.importIndexedDbForPage(page, state);
    // History restore is a no-op — CDP cannot reliably rewrite history.
    void state.history;
    return stats;
  }

  /** Sanitize-only stats when CDP is not yet available (queued restore). */
  normalizeStats(state: BrowserState): CookieNormalizeStats {
    const { skippedCount, normalizedCount } = sanitizeCookieBatch(state.cookies);
    return {
      total: state.cookies.length,
      skipped: skippedCount,
      normalized: normalizedCount,
      applied: 0,
      failedIndividual: 0,
    };
  }

  async importLocalStorage(page: Page, state: BrowserState): Promise<void> {
    let pageOrigin: string;
    try {
      const url = page.url();
      if (!url.startsWith('http')) return;
      pageOrigin = new URL(url).origin;
    } catch {
      return;
    }
    for (const item of state.localStorage) {
      if (item.origin !== pageOrigin) continue;
      try {
        await page.evaluate(
          `localStorage.setItem(${JSON.stringify(item.key)}, ${JSON.stringify(item.value)})`,
        );
      } catch {
        /* */
      }
    }
  }

  /**
   * Restore IndexedDB records for the page's current origin via page.evaluate
   * (not fake CDP addObjectStoreEntry). No-op when not on http(s).
   */
  async importIndexedDbForPage(page: Page, state: BrowserState): Promise<void> {
    let pageOrigin: string;
    try {
      const url = page.url();
      if (!url.startsWith('http')) return;
      pageOrigin = new URL(url).origin;
    } catch {
      return;
    }

    const records = state.idbRecords.filter((r) => r.origin === pageOrigin);
    for (const record of records) {
      try {
        await this.importIdbRecordOnPage(page, record);
      } catch {
        /* best-effort per record */
      }
    }
  }

  private async exportCookies(cdp: CDPSession): Promise<BrowserCookieState[]> {
    const result = (await cdp.send('Network.getAllCookies')) as {
      cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: string;
      }>;
    };
    return (result.cookies ?? [])
      .filter((c) => c.name?.trim())
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: c.sameSite,
      }));
  }

  private async exportLocalStorage(page: Page) {
    try {
      const url = page.url();
      if (!url.startsWith('http')) return [];
      const origin = new URL(url).origin;
      const entries = (await page.evaluate(`(() => {
            const out = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key == null) continue;
                out.push([key, localStorage.getItem(key) || '']);
            }
            return out;
        })()`)) as Array<[string, string]>;
      return entries.map(([key, value]) => ({ origin, key, value }));
    } catch {
      return [];
    }
  }

  private async exportIndexedDb(cdp: CDPSession, page: Page): Promise<BrowserIdbRecordState[]> {
    const records: BrowserIdbRecordState[] = [];
    const seen = new Set<string>();
    const pushRecord = (record: BrowserIdbRecordState) => {
      const key = `${record.origin}\0${record.databaseName}\0${record.storeName}\0${record.keyJson}`;
      if (seen.has(key)) return;
      seen.add(key);
      records.push(record);
    };

    try {
      let pageOrigin: string | undefined;
      try {
        const url = page.url();
        if (url.startsWith('http')) {
          pageOrigin = new URL(url).origin;
        }
      } catch {
        /* skip */
      }

      if (pageOrigin) {
        for (const record of await this.exportIndexedDbForPageOrigin(page, pageOrigin)) {
          pushRecord(record);
        }
      }

      const origins = new Set<string>();
      if (pageOrigin) origins.add(pageOrigin);

      try {
        const originsResult = (await cdp.send('Target.getTargets')) as {
          targetInfos?: Array<{ url?: string }>;
        };
        for (const t of originsResult.targetInfos ?? []) {
          if (!t.url?.startsWith('http')) continue;
          try {
            origins.add(new URL(t.url).origin);
          } catch {
            /* skip */
          }
        }
      } catch {
        /* page-attached CDP may not expose Target.getTargets */
      }

      for (const origin of origins) {
        if (origin === pageOrigin) continue;
        for (const record of await this.exportIndexedDbViaCdp(cdp, origin)) {
          pushRecord(record);
        }
      }
    } catch {
      /* best-effort */
    }
    return records;
  }

  /** Same execution context as import — reliable on page-attached CDP sessions. */
  private async exportIndexedDbForPageOrigin(
    page: Page,
    origin: string,
  ): Promise<BrowserIdbRecordState[]> {
    try {
      const rows = (await page.evaluate(`(async () => {
        const out = [];
        const list = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
        for (const info of list) {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open(info.name);
            r.onerror = () => rej(r.error);
            r.onsuccess = () => res(r.result);
          });
          for (const storeName of Array.from(db.objectStoreNames)) {
            await new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const req = store.openCursor();
              req.onerror = () => reject(req.error);
              req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                  resolve(undefined);
                  return;
                }
                out.push({
                  databaseName: info.name,
                  storeName,
                  keyJson: JSON.stringify(cursor.key),
                  valueJson: JSON.stringify(cursor.value),
                });
                cursor.continue();
              };
            });
          }
          db.close();
        }
        return out;
      })()`)) as Array<{
        databaseName: string;
        storeName: string;
        keyJson: string;
        valueJson: string;
      }>;
      return rows.map((row) => ({ origin, ...row }));
    } catch {
      return [];
    }
  }

  private async exportIndexedDbViaCdp(
    cdp: CDPSession,
    origin: string,
  ): Promise<BrowserIdbRecordState[]> {
    const records: BrowserIdbRecordState[] = [];
    let databaseNames: string[] = [];
    try {
      const namesResult = (await cdp.send('IndexedDB.requestDatabaseNames', {
        securityOrigin: origin,
      })) as { databaseNames?: string[] };
      databaseNames = namesResult.databaseNames ?? [];
    } catch {
      return records;
    }

    for (const databaseName of databaseNames) {
      let db: { objectStores?: Array<{ name: string }> } | undefined;
      try {
        db = (await cdp.send('IndexedDB.requestDatabase', {
          securityOrigin: origin,
          databaseName,
        })) as { objectStores?: Array<{ name: string }> };
      } catch {
        continue;
      }

      for (const store of db.objectStores ?? []) {
        try {
          const data = (await cdp.send('IndexedDB.requestData', {
            securityOrigin: origin,
            databaseName,
            objectStoreName: store.name,
            indexName: '',
            skipCount: 0,
            pageSize: 1000,
          })) as {
            objectData?: Array<{ key: unknown; primaryKey: unknown; value: unknown }>;
          };

          for (const entry of data.objectData ?? []) {
            records.push({
              origin,
              databaseName,
              storeName: store.name,
              keyJson: JSON.stringify(entry.key ?? entry.primaryKey),
              valueJson: JSON.stringify(entry.value),
            });
          }
        } catch {
          /* skip store */
        }
      }
    }
    return records;
  }

  private async importIdbRecordOnPage(page: Page, record: BrowserIdbRecordState): Promise<void> {
    const databaseName = JSON.stringify(record.databaseName);
    const storeName = JSON.stringify(record.storeName);
    const keyJson = JSON.stringify(record.keyJson);
    const valueJson = JSON.stringify(record.valueJson);
    await page.evaluate(
      `(async () => {
        const databaseName = ${databaseName};
        const storeName = ${storeName};
        const key = JSON.parse(${keyJson});
        const value = JSON.parse(${valueJson});
        function openDb(name, store) {
          return new Promise((resolve, reject) => {
            const req = indexedDB.open(name);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
            };
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains(store)) {
                const next = db.version + 1;
                db.close();
                const upgrade = indexedDB.open(name, next);
                upgrade.onerror = () => reject(upgrade.error);
                upgrade.onupgradeneeded = () => {
                  const udb = upgrade.result;
                  if (!udb.objectStoreNames.contains(store)) udb.createObjectStore(store);
                };
                upgrade.onsuccess = () => resolve(upgrade.result);
                return;
              }
              resolve(db);
            };
          });
        }
        const db = await openDb(databaseName, storeName);
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore(storeName).put(value, key);
        });
        db.close();
      })()`,
    );
  }

  private async exportHistory(cdp: CDPSession, page: Page): Promise<BrowserHistoryState[]> {
    try {
      const result = (await cdp.send('Page.getNavigationHistory')) as {
        currentIndex?: number;
        entries?: Array<{ id: number; url: string; title?: string; transitionType?: string }>;
      };

      const now = Date.now();
      let entries = (result.entries ?? []).map((entry, index) => ({
        url: entry.url,
        title: entry.title ?? '',
        visitedAtMs: now,
        transitionType: entry.transitionType ?? '',
        indexOrder: index,
      }));

      if (entries.length === 0) {
        try {
          const url = page.url();
          if (url.startsWith('http')) {
            entries = [
              {
                url,
                title: '',
                visitedAtMs: now,
                transitionType: 'typed',
                indexOrder: 0,
              },
            ];
          }
        } catch {
          /* ignore */
        }
      }

      return entries;
    } catch {
      return [];
    }
  }
}
