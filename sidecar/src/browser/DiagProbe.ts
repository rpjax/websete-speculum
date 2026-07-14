import * as fs from 'fs';
import { BrowserContext, CDPSession, Page } from 'patchright';
import type { BrowserCookieState, BrowserLocalStorageState } from '../BrowserState';
import type { VirtualDisplay } from './VirtualDisplay';

const STORAGE_SAMPLE_LIMIT = 50;

export type DiagProbeEvidence = {
    process?: {
        display: string;
        xvfbPid: number | null;
        wmPid: number | null;
        chromePid: number | null;
        userDataDirExists: boolean;
    };
    tabs?: {
        tabCount: number;
        urls: string[];
    };
    export?: {
        exportingState: boolean;
    };
    cookies?: BrowserCookieState[];
    storage?: BrowserLocalStorageState[];
    dom?: {
        outerHTML: string;
        text: string | null;
    } | null;
    evaluate?: unknown;
    resources?: {
        xvfbAlive: boolean;
        wmAlive: boolean;
        chromeAlive: boolean;
    };
};

export type DiagProbeOptions = {
    evaluateExpression?: string;
    domSelector?: string;
    /** Soft-cap for probe evidence JSON (bytes). Defaults to 512 KiB. */
    maxProbeResponseBytes?: number;
};

export function isProcessAlive(pid: number | null | undefined): boolean {
    if (pid === null || pid === undefined || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function capProbeData(data: DiagProbeEvidence, maxBytes: number): DiagProbeEvidence {
    let json = JSON.stringify(data);
    if (Buffer.byteLength(json, 'utf8') <= maxBytes) return data;

    const trimmed: DiagProbeEvidence = { ...data };
    if (trimmed.cookies) trimmed.cookies = trimmed.cookies.slice(0, 10);
    if (trimmed.storage) trimmed.storage = trimmed.storage.slice(0, 10);
    if (trimmed.dom?.outerHTML && trimmed.dom.outerHTML.length > 4096) {
        trimmed.dom = {
            ...trimmed.dom,
            outerHTML: trimmed.dom.outerHTML.slice(0, 4096) + '…',
        };
    }

    json = JSON.stringify(trimmed);
    if (Buffer.byteLength(json, 'utf8') <= maxBytes) return trimmed;

    return {
        process: trimmed.process,
        tabs: trimmed.tabs,
        export: trimmed.export,
        resources: trimmed.resources,
    };
}

async function sampleCookies(cdp: CDPSession): Promise<BrowserCookieState[]> {
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

async function sampleLocalStorage(cdp: CDPSession, page: Page): Promise<BrowserLocalStorageState[]> {
    void cdp;
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
        return entries
            .slice(0, STORAGE_SAMPLE_LIMIT)
            .map(([key, value]) => ({ origin, key, value }));
    } catch {
        return [];
    }
}

function resolveChromePid(context: BrowserContext): number | null {
    try {
        const browser = context.browser() as { process?: () => { pid?: number } } | null;
        const pid = browser?.process?.()?.pid;
        return typeof pid === 'number' && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

export async function collectDiagProbeEvidence(
    ops: string[],
    ctx: {
        display: VirtualDisplay;
        context: BrowserContext;
        page: Page;
        cdp: CDPSession;
        userDataDir: string;
        exportingState: boolean;
    },
    options: DiagProbeOptions = {},
): Promise<DiagProbeEvidence> {
    const opSet = new Set(ops);
    const data: DiagProbeEvidence = {};

    if (opSet.has('process')) {
        data.process = {
            display:           ctx.display.displayEnv,
            xvfbPid:           ctx.display.xvfbPid,
            wmPid:             ctx.display.wmPid,
            chromePid:         resolveChromePid(ctx.context),
            userDataDirExists: fs.existsSync(ctx.userDataDir),
        };
    }

    if (opSet.has('tabs')) {
        const pages = ctx.context.pages();
        data.tabs = {
            tabCount: pages.length,
            urls:     pages.map(p => p.url()),
        };
    }

    if (opSet.has('export')) {
        data.export = { exportingState: ctx.exportingState };
    }

    if (opSet.has('cookies')) {
        data.cookies = await sampleCookies(ctx.cdp);
    }

    if (opSet.has('storage')) {
        data.storage = await sampleLocalStorage(ctx.cdp, ctx.page);
    }

    if (opSet.has('dom') && options.domSelector) {
        const sel = JSON.stringify(options.domSelector);
        const result = await ctx.cdp.send('Runtime.evaluate', {
            expression: `(() => {
                const el = document.querySelector(${sel});
                if (!el) return null;
                return { outerHTML: el.outerHTML, text: el.textContent };
            })()`,
            returnByValue: true,
        }) as { result?: { value?: DiagProbeEvidence['dom'] } };
        data.dom = result.result?.value ?? null;
    }

    if (opSet.has('evaluate') && options.evaluateExpression) {
        const result = await ctx.cdp.send('Runtime.evaluate', {
            expression:    options.evaluateExpression,
            returnByValue: true,
        }) as { result?: { value?: unknown } };
        data.evaluate = result.result?.value ?? null;
    }

    if (opSet.has('resources')) {
        const xvfbPid = ctx.display.xvfbPid;
        const wmPid   = ctx.display.wmPid;
        const chromePid = resolveChromePid(ctx.context);
        data.resources = {
            xvfbAlive:  isProcessAlive(xvfbPid),
            wmAlive:    isProcessAlive(wmPid),
            chromeAlive: isProcessAlive(chromePid),
        };
    }

    return data;
}
