"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FFmpegCapture = void 0;
const child_process_1 = require("child_process");
const stream_1 = require("stream");
const Protocol_1 = require("./Protocol");
/**
 * Captures frames from an Xvfb display using FFmpeg x11grab and relays them
 * to the caller as encoded binary messages.
 *
 * ── Why FFmpeg x11grab instead of CDP Page.captureScreenshot? ────────────────
 * CDP capture forces a Chrome render + JPEG encode cycle per request.  With
 * SwiftShader (software rendering) this takes 25–50 ms, capping throughput at
 * 20–40 fps regardless of transport or protocol.
 *
 * FFmpeg x11grab reads the Xvfb framebuffer via XShm (shared memory — a direct
 * memcpy from the kernel buffer, no X11 protocol round-trip).  libjpeg encodes
 * at ~2 ms/frame.  Chrome keeps rendering to Xvfb at its own pace; FFmpeg
 * samples that buffer at exactly TARGET_FPS, sending duplicate frames only when
 * there is nothing new to show (handled by the identity hash skip below).
 *
 * ── Startup confirmation ──────────────────────────────────────────────────────
 * FFmpegCapture.start() is async and does NOT return until FFmpeg has produced
 * its first JPEG frame. If FFmpeg exits before producing any output (e.g. not
 * in PATH, or the display is not yet ready), start() rejects with an error.
 * This gives callers a clear failure signal rather than a silently dead capture.
 *
 * ── Frame identity skip ───────────────────────────────────────────────────────
 * For static content, FFmpeg re-encodes the same pixels deterministically:
 * same Xvfb content → identical JPEG bytes → same 32-byte prefix+suffix hash →
 * frame is dropped before hitting the WebSocket.
 *
 * ── Frame dropping ────────────────────────────────────────────────────────────
 * The onFrame callback is fire-and-forget.  The caller (Session) applies an
 * in-flight guard on the WebSocket send; frames are silently dropped when the
 * network cannot keep up, preventing unbounded buffer growth.
 */
const FFMPEG_BIN = process.env['FFMPEG_BIN'] ?? 'ffmpeg';
const TARGET_FPS = 60;
const JPEG_QUALITY = 3; // FFmpeg -q:v: 1 = best, 31 = worst.  3 ≈ JPEG Q85.
class FFmpegCapture {
    _proc = null;
    _stopped = false;
    _frameId = 0;
    constructor() { }
    /**
     * Spawns FFmpeg and waits until the first JPEG frame is produced before
     * returning. This confirms that FFmpeg started successfully and x11grab
     * connected to the display.
     *
     * @throws if FFmpeg exits before producing any output (spawn error, ENOENT,
     *         display not ready, etc.).
     */
    static start(displayNum, width, height, onFrame) {
        const fc = new FFmpegCapture();
        return new Promise((resolve, reject) => {
            // settle() ensures only the first outcome (frame | error | exit)
            // resolves or rejects the promise. Subsequent calls are no-ops.
            let settled = false;
            function settle(fn) {
                if (settled)
                    return;
                settled = true;
                fn();
            }
            fc._spawn(displayNum, width, height, (firstJpeg) => {
                // First frame produced — FFmpeg is alive and healthy.
                onFrame((0, Protocol_1.encodeFullFrame)(++fc._frameId, firstJpeg));
                settle(() => resolve(fc));
            }, (err) => settle(() => reject(err)), onFrame);
        });
    }
    // ── Internal spawn ────────────────────────────────────────────────────────
    _spawn(displayNum, width, height, onFirstFrame, onStartError, onFrame) {
        const display = `:${displayNum}`;
        const proc = (0, child_process_1.spawn)(FFMPEG_BIN, [
            '-loglevel', 'error',
            // ── Input ────────────────────────────────────────────────────────
            '-f', 'x11grab',
            '-video_size', `${width}x${height}`,
            '-framerate', String(TARGET_FPS),
            '-draw_mouse', '0',
            '-i', display,
            // ── Output ───────────────────────────────────────────────────────
            '-vcodec', 'mjpeg',
            '-q:v', String(JPEG_QUALITY),
            '-f', 'image2pipe',
            'pipe:1',
        ], {
            env: { ...process.env, DISPLAY: display },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this._proc = proc;
        const splitter = new JpegSplitter();
        proc.stdout.pipe(splitter);
        let prevHash = '';
        let firstFrame = true;
        splitter.on('data', (jpeg) => {
            if (this._stopped)
                return;
            // Cheap identity check: same pixels → same JPEG bytes from FFmpeg.
            const hash = jpeg.subarray(0, 16).toString('hex') +
                jpeg.subarray(-16).toString('hex');
            if (hash === prevHash) {
                // No new content — but this still proves FFmpeg is running.
                if (firstFrame) {
                    firstFrame = false;
                    onFirstFrame(jpeg);
                }
                return;
            }
            prevHash = hash;
            if (firstFrame) {
                firstFrame = false;
                onFirstFrame(jpeg);
                return; // onFirstFrame already relays this frame
            }
            onFrame((0, Protocol_1.encodeFullFrame)(++this._frameId, jpeg));
        });
        proc.stderr.on('data', (chunk) => {
            if (!this._stopped) {
                console.error('[FFmpegCapture]', chunk.toString().trimEnd());
            }
        });
        proc.on('error', (err) => {
            // Spawn-level error (ENOENT, EACCES, etc.).
            onStartError(new Error(`[FFmpegCapture] Failed to spawn FFmpeg: ${err.message}`));
            if (!this._stopped) {
                console.error('[FFmpegCapture] spawn error:', err.message);
            }
        });
        proc.on('close', (code, signal) => {
            if (firstFrame) {
                // Exited before producing a single frame — startup failure.
                onStartError(new Error(`[FFmpegCapture] FFmpeg exited before producing any frames ` +
                    `(code=${code} signal=${signal}). ` +
                    `Check that DISPLAY :${displayNum} is running and accessible.`));
            }
            else if (!this._stopped) {
                console.error(`[FFmpegCapture] FFmpeg exited unexpectedly — code=${code} signal=${signal}`);
            }
        });
    }
    async stop() {
        if (this._stopped)
            return;
        this._stopped = true;
        if (this._proc) {
            this._proc.kill('SIGTERM');
            this._proc = null;
        }
    }
}
exports.FFmpegCapture = FFmpegCapture;
/**
 * Transform stream that splits a raw concatenated JPEG byte stream (as output
 * by `ffmpeg -f image2pipe -vcodec mjpeg`) into individual JPEG Buffers.
 *
 * JPEG byte-stuffing guarantees that 0xFF bytes inside entropy-coded data are
 * always followed by 0x00.  Therefore the two-byte sequence 0xFF 0xD9 (EOI
 * marker) is unique — it cannot appear inside a valid JPEG payload — making
 * it a reliable frame boundary.
 *
 * ── Performance design ───────────────────────────────────────────────────────
 * The naive implementation uses Buffer.concat() on every incoming chunk, which
 * is O(n²): each concat copies all accumulated bytes plus the new chunk.
 * At 60 fps with multi-chunk frames this causes thousands of allocations and
 * copies per second.
 *
 * This implementation uses a single pre-allocated, geometrically-growing buffer
 * (_buf) with an explicit write cursor (_len).  Incoming chunks are copied in
 * once via Buffer.copy (a single memcpy).  Frame extraction compacts the buffer
 * in-place via memmove-safe overlapping Buffer.copy.  The only per-frame
 * allocation is the Buffer.from() that hands ownership of the JPEG to the
 * downstream consumer.
 */
class JpegSplitter extends stream_1.Transform {
    // Pre-allocated accumulation buffer (256 KB initial, grows geometrically).
    // _len tracks the amount of valid data; _buf.length is the physical capacity.
    _buf = Buffer.allocUnsafe(256 * 1024);
    _len = 0;
    // Safety cap: discard and resync if buffer grows beyond this without a
    // complete frame being found (e.g. corrupt / truncated stream).
    static MAX_BUF = 8 * 1024 * 1024; // 8 MB
    _transform(chunk, _enc, cb) {
        // ── Grow the accumulation buffer if needed ────────────────────────────
        const needed = this._len + chunk.length;
        if (needed > JpegSplitter.MAX_BUF) {
            // Over cap: discard current accumulation and start fresh.
            this._len = 0;
        }
        if (needed > this._buf.length) {
            // Geometrically grow (double) so future appends are O(1) amortised.
            const newCap = Math.min(Math.max(this._buf.length * 2, needed), JpegSplitter.MAX_BUF);
            const newBuf = Buffer.allocUnsafe(newCap);
            this._buf.copy(newBuf, 0, 0, this._len);
            this._buf = newBuf;
        }
        // Append chunk — single memcpy, no intermediate allocation.
        chunk.copy(this._buf, this._len);
        this._len += chunk.length;
        // ── Extract all complete JPEG frames ──────────────────────────────────
        while (this._len >= 4) {
            // Find SOI (0xFF 0xD8).
            const soi = this._find(0xFF, 0xD8, 0);
            if (soi === -1) {
                this._len = 0;
                break;
            } // no frame start — discard all
            // Compact: remove any leading garbage before the SOI.
            // Buffer.copy with overlapping src/dst is memmove-safe in Node.js.
            if (soi > 0) {
                this._buf.copy(this._buf, 0, soi, this._len);
                this._len -= soi;
                if (this._len < 4)
                    break;
            }
            // Find EOI (0xFF 0xD9) — search after the 2-byte SOI marker.
            const eoi = this._find(0xFF, 0xD9, 2);
            if (eoi === -1)
                break; // incomplete frame — wait for more data
            // Emit the complete frame as a new buffer (transfers ownership).
            const frameEnd = eoi + 2;
            this.push(Buffer.from(this._buf.subarray(0, frameEnd)));
            // Compact: slide remaining data to position 0.
            const remaining = this._len - frameEnd;
            if (remaining > 0) {
                this._buf.copy(this._buf, 0, frameEnd, this._len);
            }
            this._len = remaining;
        }
        cb();
    }
    _flush(cb) {
        this._len = 0; // release any partial frame on stream end
        cb();
    }
    /** Finds the two-byte marker [b1, b2] starting at `from` within [0, _len). */
    _find(b1, b2, from) {
        const end = this._len - 1; // need at least two bytes
        for (let i = from; i < end; i++) {
            if (this._buf[i] === b1 && this._buf[i + 1] === b2)
                return i;
        }
        return -1;
    }
}
