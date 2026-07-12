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
    const localStorage = await exportLocalStorage(cdp, page);
    const idbRecords = await exportIndexedDb(cdp);
    const history = await exportHistory(cdp);

    return { cookies, localStorage, idbRecords, history };
}

export async function importBrowserState(
    cdp: CDPSession,
    page: Page,
    state: BrowserStatePayload,
): Promise<void> {
    if (state.cookies.length > 0) {
        await cdp.send('Network.setCookies', {
            cookies: state.cookies.map(c => ({
                name:     c.name,
                value:    c.value,
                domain:   c.domain,
                path:     c.path,
                expires:  c.expires,
                httpOnly: c.httpOnly,
                secure:   c.secure,
                sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
            })),
        });
    }

    for (const item of state.localStorage) {
        try {
            const securityOrigin = item.origin;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const storageId = await (cdp as any).send('DOMStorage.getStorageIdForOrigin', {
                origin: securityOrigin,
                isLocalStorage: true,
            }) as { storageId?: { securityOrigin?: string; isLocalStorage: boolean } };

            if (!storageId.storageId) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (cdp as any).send('DOMStorage.setDOMStorageItem', {
                storageId: storageId.storageId,
                key:       item.key,
                value:     item.value,
            });
        } catch {
            // best-effort per origin
        }
    }

    for (const record of state.idbRecords) {
        try {
            await importIdbRecord(cdp, record);
        } catch {
            // best-effort
        }
    }

    void page;
    void state.history;
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

    return (result.cookies ?? []).map(c => ({
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path,
        expires:  c.expires,
        httpOnly: !!c.httpOnly,
        secure:   !!c.secure,
        sameSite: c.sameSite,
    }));
}

async function exportLocalStorage(cdp: CDPSession, page: Page): Promise<BrowserLocalStorageState[]> {
    const items: BrowserLocalStorageState[] = [];
    const origins = new Set<string>();

    try {
        const frames = page.frames();
        for (const frame of frames) {
            const url = frame.url();
            if (!url.startsWith('http')) continue;
            try {
                const origin = new URL(url).origin;
                origins.add(origin);
            } catch { /* skip */ }
        }
    } catch { /* skip */ }

    for (const origin of origins) {
        try {
            const storageId = await (cdp as any).send('DOMStorage.getStorageIdForOrigin', {
                origin,
                isLocalStorage: true,
            }) as { storageId?: { securityOrigin?: string; isLocalStorage: boolean } };

            if (!storageId.storageId) continue;

            const entries = await (cdp as any).send('DOMStorage.getDOMStorageItems', {
                storageId: storageId.storageId,
            }) as { entries?: string[][] };

            for (const [key, value] of entries.entries ?? []) {
                items.push({ origin, key, value });
            }
        } catch {
            // skip origin
        }
    }

    return items;
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

async function exportHistory(cdp: CDPSession): Promise<BrowserHistoryState[]> {
    try {
        const result = await cdp.send('Page.getNavigationHistory') as {
            currentIndex?: number;
            entries?: Array<{ id: number; url: string; title?: string; transitionType?: string }>;
        };

        const now = Date.now();
        return (result.entries ?? []).map((entry, index) => ({
            url:            entry.url,
            title:          entry.title ?? '',
            visitedAtMs:    now,
            transitionType: entry.transitionType ?? '',
            indexOrder:     index,
        }));
    } catch {
        return [];
    }
}
