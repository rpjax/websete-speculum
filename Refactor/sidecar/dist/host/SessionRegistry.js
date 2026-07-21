"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRegistry = void 0;
const crypto_1 = require("crypto");
const EventBridge_1 = require("./EventBridge");
class SessionRegistry {
    factory;
    sessions = new Map();
    createListeners = new Set();
    constructor(factory) {
        this.factory = factory;
    }
    create(preferredId) {
        const sessionId = preferredId && preferredId.length > 0 ? preferredId : (0, crypto_1.randomUUID)();
        if (this.sessions.has(sessionId)) {
            throw Object.assign(new Error(`session already exists: ${sessionId}`), {
                code: 'ALREADY_EXISTS',
            });
        }
        const bridge = new EventBridge_1.EventBridge(sessionId);
        const session = this.factory.create(sessionId, bridge);
        const entry = { session, bridge };
        this.sessions.set(sessionId, entry);
        for (const listener of this.createListeners) {
            listener(entry);
        }
        return entry;
    }
    get(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) {
            throw Object.assign(new Error(`session not found: ${sessionId}`), {
                code: 'NOT_FOUND',
            });
        }
        return entry;
    }
    listBridges() {
        return [...this.sessions.values()].map((e) => e.bridge);
    }
    /** Notify when a session is created (e.g. Control stream attaches permission sinks). */
    onCreate(listener) {
        this.createListeners.add(listener);
        return () => this.createListeners.delete(listener);
    }
    async dispose(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry)
            return;
        this.sessions.delete(sessionId);
        entry.bridge.close();
        await entry.session.dispose();
    }
    async disposeAll() {
        const ids = [...this.sessions.keys()];
        await Promise.all(ids.map((id) => this.dispose(id)));
    }
}
exports.SessionRegistry = SessionRegistry;
//# sourceMappingURL=SessionRegistry.js.map