import { CDPSession, Page } from 'patchright';

export interface BrowserCookieState {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
}

export interface BrowserLocalStorageState {
    origin: string;
    key: string;
    value: string;
}

export interface BrowserIdbRecordState {
    origin: string;
    databaseName: string;
    storeName: string;
    keyJson: string;
    valueJson: string;
}

export interface BrowserHistoryState {
    url: string;
    title: string;
    visitedAtMs: number;
    transitionType: string;
    indexOrder: number;
}

export interface BrowserStatePayload {
    cookies: BrowserCookieState[];
    localStorage: BrowserLocalStorageState[];
    idbRecords: BrowserIdbRecordState[];
    history: BrowserHistoryState[];
}

export async function exportBrowserState(cdp: CDPSession, page: Page): Promise<BrowserStatePayload> {
    const cookies = await exportCookies(cdp);
    const localStorage = await exportLocalStorage(page);
    const idbRecords = await exportIndexedDb(cdp);
    const history = await exportHistory(cdp, page);

    return { cookies, localStorage, idbRecords, history };
}

/** CDP Network.CookieParam — only fields Chromium accepts. */
export type CdpCookieParam = {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
};

const CDP_SAME_SITE_MAP: Record<string, 'Strict' | 'Lax' | 'None'> = {
    strict: 'Strict',
    lax:    'Lax',
    none:   'None',
};

/** Heuristic: timestamps above this are likely milliseconds, not seconds. Year ~2255 in seconds. */
const EPOCH_MS_THRESHOLD = 9_999_999_999;

export interface CookieSanitizeResult {
    cookie: CdpCookieParam | null;
    skipped: boolean;
    reason?: string;
}

/**
 * Full CDP-safe sanitization for a persisted cookie:
 * - Omit if name is empty/whitespace (CDP rejects nameless cookies)
 * - Normalize sameSite case-insensitively; omit unrecognized values
 * - Enforce secure=true when sameSite=None (Chrome requirement)
 * - Omit expires <= 0 (treat as session cookie)
 * - Detect millisecond timestamps and convert to seconds
 * - Omit domain if empty (let CDP infer from URL)
 */
export function sanitizeCookieForCdp(c: BrowserCookieState): CdpCookieParam | null {
    if (!c.name || !c.name.trim()) return null;

    const cookie: CdpCookieParam = {
        name:     c.name.trim(),
        value:    c.value ?? '',
        httpOnly: !!c.httpOnly,
        secure:   !!c.secure,
    };

    if (typeof c.domain === 'string' && c.domain.trim()) {
        cookie.domain = c.domain.trim();
    }
    if (typeof c.path === 'string' && c.path.trim()) {
        cookie.path = c.path;
    }

    if (typeof c.expires === 'number' && c.expires > 0) {
        cookie.expires = c.expires > EPOCH_MS_THRESHOLD
            ? Math.round(c.expires / 1000)
            : c.expires;
    }

    if (typeof c.sameSite === 'string' && c.sameSite.trim()) {
        const normalized = CDP_SAME_SITE_MAP[c.sameSite.trim().toLowerCase()];
        if (normalized) {
            cookie.sameSite = normalized;
            if (normalized === 'None') {
                cookie.secure = true;
            }
        }
    }

    return cookie;
}

/** Sanitize a batch, returning valid cookies + stats. */
export function sanitizeCookieBatch(cookies: BrowserCookieState[]): {
    valid: CdpCookieParam[];
    skippedCount: number;
} {
    const valid: CdpCookieParam[] = [];
    let skippedCount = 0;
    for (const c of cookies) {
        const result = sanitizeCookieForCdp(c);
        if (result) {
            valid.push(result);
        } else {
            skippedCount++;
        }
    }
    return { valid, skippedCount };
}

export interface ImportCookieStats {
    total: number;
    sanitized: number;
    skipped: number;
    applied: number;
    failedIndividual: number;
}

export async function importBrowserState(
    cdp: CDPSession,
    page: Page,
    state: BrowserStatePayload,
): Promise<ImportCookieStats> {
    const stats: ImportCookieStats = {
        total: state.cookies.length,
        sanitized: 0,
        skipped: 0,
        applied: 0,
        failedIndividual: 0,
    };

    if (state.cookies.length > 0) {
        const { valid, skippedCount } = sanitizeCookieBatch(state.cookies);
        stats.sanitized = valid.length;
        stats.skipped = skippedCount;

        if (valid.length > 0) {
            try {
                await cdp.send('Network.setCookies', { cookies: valid });
                stats.applied = valid.length;
            } catch {
                // Batch failed — retry individually for resilience.
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

        if (stats.applied === 0 && stats.total > 0 && stats.skipped < stats.total) {
            throw new Error(
                `cookie_import_invalid: 0/${stats.total} cookies applied ` +
                `(${stats.skipped} skipped by sanitize, ${stats.failedIndividual} rejected by CDP)`,
            );
        }
    }

    // IndexedDB + LS need a live document origin — LS applied after first navigation.
    for (const record of state.idbRecords) {
        try {
            await importIdbRecord(cdp, record);
        } catch {
            // best-effort
        }
    }

    void page;
    void state.history;
    void state.localStorage;
    return stats;
}

function originHostsMatch(a: string, b: string): boolean {
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        return ua.protocol === ub.protocol && ua.hostname === ub.hostname;
    } catch {
        return a === b;
    }
}

/** Apply localStorage after the session has navigated to a matching http(s) origin. */
export async function importLocalStorageAfterNavigation(
    page: Page,
    state: BrowserStatePayload,
): Promise<void> {
    let pageOrigin: string;
    try {
        const url = page.url();
        if (!url.startsWith('http')) return;
        pageOrigin = new URL(url).origin;
    } catch {
        return;
    }

    const items = state.localStorage ?? [];
    for (const item of items) {
        if (item.origin !== pageOrigin && !originHostsMatch(item.origin, pageOrigin)) continue;
        try {
            await page.evaluate(
                `localStorage.setItem(${JSON.stringify(item.key)}, ${JSON.stringify(item.value)})`,
            );
        } catch {
            // best-effort per key
        }
    }
}

/** Normalize sameSite on export so persisted data is always in canonical form. */
function normalizeSameSiteForPersist(raw?: string): string | undefined {
    if (!raw || !raw.trim()) return undefined;
    return CDP_SAME_SITE_MAP[raw.trim().toLowerCase()];
}

async function exportCookies(cdp: CDPSession): Promise<BrowserCookieState[]> {
    const result = await cdp.send('Network.getAllCookies') as {
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
        .filter(c => c.name && c.name.trim())
        .map(c => ({
            name:     c.name,
            value:    c.value,
            domain:   c.domain,
            path:     c.path,
            expires:  (typeof c.expires === 'number' && c.expires > 0) ? c.expires : undefined,
            httpOnly: !!c.httpOnly,
            secure:   !!c.secure,
            sameSite: normalizeSameSiteForPersist(c.sameSite),
        }));
}

async function exportLocalStorage(page: Page): Promise<BrowserLocalStorageState[]> {
    try {
        const url = page.url();
        if (!url.startsWith('http')) return [];
        const origin = new URL(url).origin;
        const entries = await page.evaluate(`(() => {
            const out = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key == null) continue;
                out.push([key, localStorage.getItem(key) || '']);
            }
            return out;
        })()`) as Array<[string, string]>;
        return entries.map(([key, value]) => ({ origin, key, value }));
    } catch {
        return [];
    }
}

async function exportIndexedDb(cdp: CDPSession): Promise<BrowserIdbRecordState[]> {
    const records: BrowserIdbRecordState[] = [];

    let securityOrigins: string[] = [];
    try {
        const result = await cdp.send('Storage.getStorageKeyForFrame', { frameId: '0' });
        void result;
    } catch { /* optional */ }

    try {
        const dbNames = await cdp.send('IndexedDB.requestDatabaseNames', {
            securityOrigin: undefined,
        }) as { databaseNames?: string[] };
        void dbNames;
    } catch { /* fallback below */ }

    // Enumerate via runtime evaluate on known origins from cookies/localStorage is limited;
    // use IndexedDB.requestDatabaseNames per origin from page.
    try {
        const originsResult = await cdp.send('Target.getTargets') as { targetInfos?: Array<{ url?: string }> };
        const origins = new Set<string>();
        for (const t of originsResult.targetInfos ?? []) {
            if (!t.url?.startsWith('http')) continue;
            try { origins.add(new URL(t.url).origin); } catch { /* skip */ }
        }

        for (const origin of origins) {
            let databaseNames: string[] = [];
            try {
                const namesResult = await cdp.send('IndexedDB.requestDatabaseNames', {
                    securityOrigin: origin,
                }) as { databaseNames?: string[] };
                databaseNames = namesResult.databaseNames ?? [];
            } catch { continue; }

            for (const databaseName of databaseNames) {
                let db: { objectStores?: Array<{ name: string }> } | undefined;
                try {
                    db = await cdp.send('IndexedDB.requestDatabase', {
                        securityOrigin: origin,
                        databaseName,
                    }) as { objectStores?: Array<{ name: string }> };
                } catch { continue; }

                for (const store of db.objectStores ?? []) {
                    try {
                        const data = await cdp.send('IndexedDB.requestData', {
                            securityOrigin: origin,
                            databaseName,
                            objectStoreName: store.name,
                            indexName:       '',
                            skipCount:       0,
                            pageSize:        1000,
                        }) as { objectData?: Array<{ key: unknown; primaryKey: unknown; value: unknown }> };

                        for (const entry of data.objectData ?? []) {
                            records.push({
                                origin,
                                databaseName,
                                storeName: store.name,
                                keyJson:   JSON.stringify(entry.key ?? entry.primaryKey),
                                valueJson: JSON.stringify(entry.value),
                            });
                        }
                    } catch { /* skip store */ }
                }
            }
        }
    } catch { /* best-effort */ }

    void securityOrigins;
    return records;
}

async function importIdbRecord(cdp: CDPSession, record: BrowserIdbRecordState): Promise<void> {
    const key = JSON.parse(record.keyJson);
    const value = JSON.parse(record.valueJson);

    await cdp.send('IndexedDB.clearObjectStore', {
        securityOrigin:  record.origin,
        databaseName:    record.databaseName,
        objectStoreName: record.storeName,
    }).catch(() => undefined);

    await (cdp as any).send('IndexedDB.addObjectStoreEntry', {
        securityOrigin:  record.origin,
        databaseName:    record.databaseName,
        objectStoreName: record.storeName,
        key,
        value,
    });
}

async function exportHistory(cdp: CDPSession, page: Page): Promise<BrowserHistoryState[]> {
    try {
        const result = await cdp.send('Page.getNavigationHistory') as {
            currentIndex?: number;
            entries?: Array<{ id: number; url: string; title?: string; transitionType?: string }>;
        };

        const now = Date.now();
        let entries = (result.entries ?? []).map((entry, index) => ({
            url:            entry.url,
            title:          entry.title ?? '',
            visitedAtMs:    now,
            transitionType: entry.transitionType ?? '',
            indexOrder:     index,
        }));

        // Short-lived sessions sometimes report empty CDP history — seed the current URL.
        if (entries.length === 0) {
            try {
                const url = page.url();
                if (url.startsWith('http')) {
                    entries = [{
                        url,
                        title: '',
                        visitedAtMs: now,
                        transitionType: 'typed',
                        indexOrder: 0,
                    }];
                }
            } catch { /* ignore */ }
        }

        return entries;
    } catch {
        return [];
    }
}
