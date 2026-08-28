export type EmitterListener<T> = (detail: T) => void

/** Minimal typed event bus over EventTarget. */
export class Emitter<TEvents> {
  private readonly target = new EventTarget()

  on<K extends keyof TEvents & string>(
    type: K,
    listener: EmitterListener<TEvents[K]>,
  ): () => void {
    const wrapped = (event: Event): void => {
      listener((event as CustomEvent<TEvents[K]>).detail)
    }
    this.target.addEventListener(type, wrapped)
    return () => this.target.removeEventListener(type, wrapped)
  }

  emit<K extends keyof TEvents & string>(type: K, detail?: TEvents[K]): void {
    this.target.dispatchEvent(new CustomEvent(type, { detail }))
  }
}
