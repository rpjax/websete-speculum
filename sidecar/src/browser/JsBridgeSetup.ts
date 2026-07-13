import { WebSocket } from 'ws';
import { CDPSession } from 'patchright';
import { encodeConsoleMessage, encodeEvalResult, CONSOLE_LEVELS } from '../protocol/wire-protocol';

/** Maps Log.entryAdded severity strings to wire-level level bytes. */
const LOG_LEVEL: Record<string, number> = { verbose: 0, info: 3, warning: 1, error: 2 };

/**
 * JsBridge console forwarding and evaljs result encoding.
 */
export class JsBridgeSetup {
    static async setup(cdp: CDPSession, ws: WebSocket, sessionId: string): Promise<void> {
        await cdp.send('Runtime.enable', {});
        await cdp.send('Log.enable',     {});

        const sendConsole = (level: number, text: string): void => {
            if (ws.readyState !== ws.OPEN) return;
            if (text.length > 65_536) text = text.slice(0, 65_536) + ' … [truncated]';
            ws.send(encodeConsoleMessage(level, text), { binary: true });
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Runtime.consoleAPICalled', (event: any) => {
            const level = CONSOLE_LEVELS[event.type as string] ?? 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = (event.args as any[]).map((arg: any): string => {
                if (arg.type === 'undefined')              return 'undefined';
                if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
                if (arg.value !== undefined)
                    return typeof arg.value === 'string'
                        ? arg.value
                        : JSON.stringify(arg.value);
                return String(arg.description ?? '');
            }).join(' ');
            sendConsole(level, text);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdp.on('Log.entryAdded', (event: any) => {
            const entry = event.entry as { level: string; text: string };
            sendConsole(LOG_LEVEL[entry.level] ?? 0, entry.text);
        });

        console.log(`[${sessionId}] JsBridge console forwarding active`);
    }

    static createEvalHandler(cdp: CDPSession, ws: WebSocket): (id: number, code: string) => Promise<void> {
        return async (id: number, code: string): Promise<void> => {
            let ok    = true;
            let value = '';

            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const res: any = await cdp.send('Runtime.evaluate', {
                    expression:    JsBridgeSetup.wrapEval(code),
                    returnByValue: true,
                    awaitPromise:  true,
                    timeout:       10_000,
                });

                if (res.exceptionDetails) {
                    ok    = false;
                    value = res.exceptionDetails.text ?? 'Evaluation error';
                } else {
                    const r = res.result?.value as { ok: boolean; v: string | null } | undefined;
                    if (!r) {
                        value = '';
                    } else if (r.ok) {
                        value = r.v ?? '';
                    } else {
                        ok    = false;
                        value = r.v ?? 'Unknown error';
                    }
                }
            } catch (err) {
                ok    = false;
                value = (err as Error).message;
            }

            if (ws.readyState === ws.OPEN) {
                ws.send(encodeEvalResult(id, ok, value), { binary: true });
            }
        };
    }

    private static wrapEval(code: string): string {
        return (
            `(async function(){try{`
            + `var __r=(0,eval)(${JSON.stringify(code)});`
            + `if(__r&&typeof __r.then==='function')__r=await __r;`
            + `return{ok:true,v:__r===undefined?null:`
            + `(function(){try{return JSON.stringify(__r)}catch(_){return String(__r)}})()}`
            + `}catch(e){return{ok:false,v:e.message||String(e)}}})() `
        );
    }
}
