import { randomUUID } from 'crypto';
import {
  type BrowserSession,
  type BrowserSessionFactory,
} from '../browser/BrowserSession';
import { EventBridge } from './EventBridge';

export interface RegisteredSession {
  session: BrowserSession;
  bridge: EventBridge;
}

export class SessionRegistry {
  private readonly sessions = new Map<string, RegisteredSession>();
  private readonly createListeners = new Set<(entry: RegisteredSession) => void>();

  constructor(private readonly factory: BrowserSessionFactory) {}

  create(preferredId?: string): RegisteredSession {
    const sessionId = preferredId && preferredId.length > 0 ? preferredId : randomUUID();
    if (this.sessions.has(sessionId)) {
      throw Object.assign(new Error(`session already exists: ${sessionId}`), {
        code: 'ALREADY_EXISTS',
      });
    }
    const bridge = new EventBridge(sessionId);
    const session = this.factory.create(sessionId, bridge);
    const entry = { session, bridge };
    this.sessions.set(sessionId, entry);
    for (const listener of this.createListeners) {
      listener(entry);
    }
    return entry;
  }

  get(sessionId: string): RegisteredSession {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw Object.assign(new Error(`session not found: ${sessionId}`), {
        code: 'NOT_FOUND',
      });
    }
    return entry;
  }

  listBridges(): EventBridge[] {
    return [...this.sessions.values()].map((e) => e.bridge);
  }

  /** Notify when a session is created (e.g. Control stream attaches permission sinks). */
  onCreate(listener: (entry: RegisteredSession) => void): () => void {
    this.createListeners.add(listener);
    return () => this.createListeners.delete(listener);
  }

  async dispose(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    entry.bridge.close();
    await entry.session.dispose();
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.dispose(id)));
  }
}
