import type { DomProjectionInput } from '@/lib/speculum'

export type DomElementInputSender = (input: DomProjectionInput) => void | Promise<void>

/**
 * Maps projected-surface DOM events to DomProjectionInput (element targetId).
 * Never blocks the UI on the network write.
 */
export function attachDomElementInput(
  host: HTMLElement,
  send: DomElementInputSender,
): () => void {
  const fire = (input: DomProjectionInput) => {
    void Promise.resolve(send(input)).catch(() => {
      // input must not block projection paint
    })
  }

  const targetIdOf = (target: EventTarget | null): number | null => {
    if (!(target instanceof Element)) return null
    // Prefer the actionable ancestor so clicks on inner spans hit button/a handlers.
    const actionable = target.closest(
      'button, a, [role="button"], input, select, textarea, summary',
    )
    const el =
      (actionable instanceof Element && actionable.hasAttribute('data-speculum-id')
        ? actionable
        : null) ?? target.closest('[data-speculum-id]')
    if (!el) return null
    const raw = el.getAttribute('data-speculum-id')
    if (!raw) return null
    const id = Number(raw)
    return Number.isFinite(id) ? id : null
  }

  const onClick = (event: MouseEvent) => {
    const targetId = targetIdOf(event.target)
    if (targetId == null) return
    event.preventDefault()
    fire({ type: 'click', targetId, payload: '{}' })
  }

  const onInput = (event: Event) => {
    const targetId = targetIdOf(event.target)
    if (targetId == null) return
    const value =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
        ? event.target.value
        : ''
    fire({
      type: 'input',
      targetId,
      payload: JSON.stringify({ value }),
    })
  }

  const onKey = (event: KeyboardEvent) => {
    const targetId = targetIdOf(event.target)
    if (targetId == null) return
    fire({
      type: event.type === 'keyup' ? 'keyup' : 'keydown',
      targetId,
      payload: JSON.stringify({ key: event.key }),
    })
  }

  const onScroll = (event: Event) => {
    const targetId = targetIdOf(event.target)
    if (targetId == null) return
    const el = event.target
    const scrollTop = el instanceof Element ? el.scrollTop : 0
    const scrollLeft = el instanceof Element ? el.scrollLeft : 0
    fire({
      type: 'scroll',
      targetId,
      payload: JSON.stringify({ scrollTop, scrollLeft }),
    })
  }

  host.addEventListener('click', onClick)
  host.addEventListener('input', onInput, true)
  host.addEventListener('change', onInput, true)
  host.addEventListener('keydown', onKey)
  host.addEventListener('keyup', onKey)
  host.addEventListener('scroll', onScroll, true)

  return () => {
    host.removeEventListener('click', onClick)
    host.removeEventListener('input', onInput, true)
    host.removeEventListener('change', onInput, true)
    host.removeEventListener('keydown', onKey)
    host.removeEventListener('keyup', onKey)
    host.removeEventListener('scroll', onScroll, true)
  }
}
