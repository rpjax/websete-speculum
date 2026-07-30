"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputController = void 0;
const TouchMoveCoalescer_1 = require("./input/TouchMoveCoalescer");
/**
 * Admits BrowserInput synchronously; serializes inject work on a promise chain.
 * Production uses OsInputBackend; unit tests inject PatchrightInputBackend.
 */
class InputController {
    _page;
    _backend;
    _touchPrimary = false;
    _movePending = null;
    _moveScheduled = false;
    /** Bumped when a gesture cancels a stale coalesced move (down/up carry coords). */
    _moveGeneration = 0;
    _chain = Promise.resolve();
    _chainDepth = 0;
    _touchMove;
    constructor(page, backend) {
        this._page = page;
        this._backend = backend;
        this._touchMove = new TouchMoveCoalescer_1.TouchMoveCoalescer((points) => {
            this._enqueueChain(() => this._backend.touch('move', points), (err) => console.warn('[Input] touchmove:', err.message));
        });
    }
    rebind(page, backend) {
        this._page = page;
        this._backend = backend;
        this._chain = Promise.resolve();
        this._chainDepth = 0;
    }
    setTouchPrimary(value) {
        this._touchPrimary = value;
    }
    get backend() {
        return this._backend;
    }
    enqueue(input) {
        try {
            this._enqueue(input);
        }
        catch (err) {
            console.warn('[Input] enqueue error:', err.message);
        }
    }
    /** Unit-test alias. */
    dispatch(input) {
        this._enqueue(input);
    }
    _enqueue(input) {
        switch (input.type) {
            case 'mousemove':
                if (this._touchPrimary)
                    return;
                this._queueMouseMove(input.x, input.y);
                return;
            case 'mousedown':
                if (this._touchPrimary)
                    return;
                this._cancelPendingMouseMove();
                this._enqueueChain(() => this._backend.down(input.button, input.x, input.y), (err) => console.warn('[Input] mousedown:', err.message));
                return;
            case 'mouseup':
                if (this._touchPrimary)
                    return;
                this._cancelPendingMouseMove();
                this._enqueueChain(() => this._backend.up(input.button, input.x, input.y), (err) => console.warn('[Input] mouseup:', err.message));
                return;
            case 'wheel':
                this._cancelPendingMouseMove();
                this._enqueueChain(() => this._backend.wheel(input.x, input.y, input.deltaX, input.deltaY), (err) => console.warn('[Input] wheel:', err.message));
                return;
            case 'keydown':
                this._enqueueChain(() => this._backend.keyDown(input.key), (err) => console.warn('[Input] keydown:', err.message));
                return;
            case 'keyup':
                if (input.key.length === 1 && input.key.charCodeAt(0) > 127)
                    return;
                this._enqueueChain(() => this._backend.keyUp(input.key), (err) => console.warn('[Input] keyup:', err.message));
                return;
            case 'type':
            case 'text':
                this._enqueueChain(() => this._backend.typeText(input.text ?? ''), (err) => console.warn('[Input] text:', err.message));
                return;
            case 'touch':
                if (input.phase === 'move') {
                    this._touchMove.queue([...input.points]);
                    return;
                }
                {
                    const pending = this._touchMove.takePending();
                    this._enqueueChain(async () => {
                        if (pending)
                            await this._backend.touch('move', pending);
                        await this._backend.touch(input.phase, [...input.points]);
                    }, (err) => console.warn('[Input] touch:', err.message));
                }
                return;
            case 'goback':
                void this._page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
                    console.warn('[Input] goback:', err.message);
                });
                return;
            case 'goforward':
                void this._page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
                    console.warn('[Input] goforward:', err.message);
                });
                return;
        }
    }
    _cancelPendingMouseMove() {
        this._movePending = null;
        this._moveGeneration++;
    }
    _enqueueChain(work, onError) {
        this._chainDepth++;
        this._chain = this._chain
            .then(work)
            .catch(onError)
            .finally(() => {
            this._chainDepth = Math.max(0, this._chainDepth - 1);
        });
    }
    _queueMouseMove(x, y) {
        this._movePending = { x, y };
        if (this._moveScheduled)
            return;
        this._moveScheduled = true;
        const generation = this._moveGeneration;
        setImmediate(() => {
            this._moveScheduled = false;
            if (generation !== this._moveGeneration)
                return;
            const p = this._movePending;
            this._movePending = null;
            if (!p || this._touchPrimary)
                return;
            this._enqueueChain(() => this._backend.move(p.x, p.y), () => { });
        });
    }
    get pendingCount() {
        return (this._movePending ? 1 : 0) + this._chainDepth;
    }
    get chainDepth() {
        return this._chainDepth;
    }
    async dispose() {
        this._movePending = null;
        this._moveScheduled = false;
        this._chainDepth = 0;
        this._touchMove.takePending();
        await this._backend.dispose();
    }
}
exports.InputController = InputController;
//# sourceMappingURL=Input.js.map