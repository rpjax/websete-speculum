/**
 * Live Gecko: SW de ativo na origem do usuário. Pedido → hub Kind 0x06.
 * Sem rewrite de URL. Sem WS do supervisor no browser.
 */

import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame'

export type ProjectedAssetFetch = (args: {
  contextId: number
  url: string
  destination: string
  range: string
}) => Promise<{ ok: boolean; bytes?: ArrayBuffer; contentType?: string; error?: string }>

let swReg: ServiceWorkerRegistration | null = null

export async function ensureLiveAssetSw(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service worker indisponível')
  }
  swReg = await navigator.serviceWorker.register('/asset-sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = window.setTimeout(done, 2000)
      navigator.serviceWorker.addEventListener('controllerchange', done, { once: true })
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.removeEventListener('controllerchange', done)
        done()
      }
    })
  }
  const sw = navigator.serviceWorker.controller ?? swReg.active
  sw?.postMessage({ type: 'token', token })
  sw?.postMessage({ type: 'ctx', contextId: CONTEXT_ID_ROOT })
}

export function registerLiveAssetContext(contextId: number, win: Window = window): void {
  if (!('serviceWorker' in win.navigator)) {
    return
  }
  void win.navigator.serviceWorker.ready.then((reg) => {
    ;(reg.active ?? win.navigator.serviceWorker.controller)?.postMessage({ type: 'ctx', contextId })
  })
}

export function wireLiveAssetSw(fetchAsset: ProjectedAssetFetch, ctx: number): () => void {
  const onMessage = (ev: MessageEvent) => {
    const msg = ev.data as {
      type?: string
      url?: string
      dest?: string
      range?: string
      id?: number
      contextId?: number
    }
    if (msg?.type !== 'asset-fetch' || typeof msg.url !== 'string' || typeof msg.id !== 'number') {
      return
    }
    const fetchCtx =
      typeof msg.contextId === 'number' && Number.isInteger(msg.contextId) && msg.contextId >= 1
        ? msg.contextId
        : ctx
    void fetchAsset({
      contextId: fetchCtx,
      url: msg.url,
      destination: msg.dest ?? '',
      range: msg.range ?? '',
    }).then(
      (res) => {
        if (!res.ok || !res.bytes) {
          ev.source?.postMessage({ type: 'asset', id: msg.id, ok: false, error: res.error || 'denied' })
          return
        }
        ev.source?.postMessage(
          { type: 'asset', id: msg.id, ok: true, bytes: res.bytes, contentType: res.contentType || '' },
          { transfer: [res.bytes] },
        )
      },
      (err: Error) => {
        ev.source?.postMessage({ type: 'asset', id: msg.id, ok: false, error: err.message })
      },
    )
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
