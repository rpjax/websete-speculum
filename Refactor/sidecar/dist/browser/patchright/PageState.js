"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageState = void 0;
const CDP_SAME_SITE = {
    strict: 'Strict',
    lax: 'Lax',
    none: 'None',
};
const EPOCH_MS_THRESHOLD = 9_999_999_999;
function sanitizeCookie(c) {
    if (!c.name?.trim())
        return null;
    const cookie = {
        name: c.name.trim(),
        value: c.value ?? '',
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
    };
    if (c.domain?.trim())
        cookie.domain = c.domain.trim();
    if (c.path?.trim())
        cookie.path = c.path;
    if (typeof c.expires === 'number' && c.expires > 0) {
        cookie.expires = c.expires > EPOCH_MS_THRESHOLD ? Math.round(c.expires / 1000) : c.expires;
    }
    if (c.sameSite?.trim()) {
        const normalized = CDP_SAME_SITE[c.sameSite.trim().toLowerCase()];
        if (normalized) {
            cookie.sameSite = normalized;
            if (normalized === 'None')
                cookie.secure = true;
        }
    }
    return cookie;
}
class PageState {
    async export(cdp, page) {
        const cookies = await this.exportCookies(cdp);
        const localStorage = await this.exportLocalStorage(page);
        const idbRecords = await this.exportIndexedDb(cdp);
        const history = await this.exportHistory(cdp, page);
        return { cookies, localStorage, idbRecords, history };
    }
    async restore(cdp, page, state) {
        const valid = state.cookies.map(sanitizeCookie).filter((c) => !!c);
        if (valid.length > 0) {
            try {
                await cdp.send('Network.setCookies', { cookies: valid });
            }
            catch {
                for (const cookie of valid) {
                    try {
                        await cdp.send('Network.setCookies', { cookies: [cookie] });
                    }
                    catch {
                        /* */
                    }
                }
            }
        }
        await this.importLocalStorage(page, state);
        await this.importIndexedDbForPage(page, state);
        // History restore is a no-op — CDP cannot reliably rewrite history.
        void state.history;
    }
    async importLocalStorage(page, state) {
        let pageOrigin;
        try {
            const url = page.url();
            if (!url.startsWith('http'))
                return;
            pageOrigin = new URL(url).origin;
        }
        catch {
            return;
        }
        for (const item of state.localStorage) {
            if (item.origin !== pageOrigin)
                continue;
            try {
                await page.evaluate(`localStorage.setItem(${JSON.stringify(item.key)}, ${JSON.stringify(item.value)})`);
            }
            catch {
                /* */
            }
        }
    }
    /**
     * Restore IndexedDB records for the page's current origin via page.evaluate
     * (not fake CDP addObjectStoreEntry). No-op when not on http(s).
     */
    async importIndexedDbForPage(page, state) {
        let pageOrigin;
        try {
            const url = page.url();
            if (!url.startsWith('http'))
                return;
            pageOrigin = new URL(url).origin;
        }
        catch {
            return;
        }
        const records = state.idbRecords.filter((r) => r.origin === pageOrigin);
        for (const record of records) {
            try {
                await this.importIdbRecordOnPage(page, record);
            }
            catch {
                /* best-effort per record */
            }
        }
    }
    async exportCookies(cdp) {
        const result = (await cdp.send('Network.getAllCookies'));
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
    async exportLocalStorage(page) {
        try {
            const url = page.url();
            if (!url.startsWith('http'))
                return [];
            const origin = new URL(url).origin;
            const entries = (await page.evaluate(`(() => {
            const out = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key == null) continue;
                out.push([key, localStorage.getItem(key) || '']);
            }
            return out;
        })()`));
            return entries.map(([key, value]) => ({ origin, key, value }));
        }
        catch {
            return [];
        }
    }
    async exportIndexedDb(cdp) {
        const records = [];
        try {
            const originsResult = (await cdp.send('Target.getTargets'));
            const origins = new Set();
            for (const t of originsResult.targetInfos ?? []) {
                if (!t.url?.startsWith('http'))
                    continue;
                try {
                    origins.add(new URL(t.url).origin);
                }
                catch {
                    /* skip */
                }
            }
            for (const origin of origins) {
                let databaseNames = [];
                try {
                    const namesResult = (await cdp.send('IndexedDB.requestDatabaseNames', {
                        securityOrigin: origin,
                    }));
                    databaseNames = namesResult.databaseNames ?? [];
                }
                catch {
                    continue;
                }
                for (const databaseName of databaseNames) {
                    let db;
                    try {
                        db = (await cdp.send('IndexedDB.requestDatabase', {
                            securityOrigin: origin,
                            databaseName,
                        }));
                    }
                    catch {
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
                            }));
                            for (const entry of data.objectData ?? []) {
                                records.push({
                                    origin,
                                    databaseName,
                                    storeName: store.name,
                                    keyJson: JSON.stringify(entry.key ?? entry.primaryKey),
                                    valueJson: JSON.stringify(entry.value),
                                });
                            }
                        }
                        catch {
                            /* skip store */
                        }
                    }
                }
            }
        }
        catch {
            /* best-effort */
        }
        return records;
    }
    async importIdbRecordOnPage(page, record) {
        const databaseName = JSON.stringify(record.databaseName);
        const storeName = JSON.stringify(record.storeName);
        const keyJson = JSON.stringify(record.keyJson);
        const valueJson = JSON.stringify(record.valueJson);
        await page.evaluate(`(async () => {
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
      })()`);
    }
    async exportHistory(cdp, page) {
        try {
            const result = (await cdp.send('Page.getNavigationHistory'));
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
                }
                catch {
                    /* ignore */
                }
            }
            return entries;
        }
        catch {
            return [];
        }
    }
}
exports.PageState = PageState;
//# sourceMappingURL=PageState.js.map