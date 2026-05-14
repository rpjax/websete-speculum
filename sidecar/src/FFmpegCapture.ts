import { spawn, ChildProcess } from 'child_process';
import { Transform, TransformCallback } from 'stream';
import { encodeFullFrame } from './Protocol';

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

const FFMPEG_BIN   = process.env['FFMPEG_BIN'] ?? 'ffmpeg';
const TARGET_FPS   = 60;
const JPEG_QUALITY = 3;   // FFmpeg -q:v: 1 = best, 31 = worst.  3 ≈ JPEG Q85.

export class FFmpegCapture {
    private _proc:    ChildProcess | null = null;
    private _stopped: boolean = false;
    private _frameId: number  = 0;

    private constructor() {}

    static async start(
        displayNum: number,
        width:      number,
        height:     number,
        onFrame:    (buf: Buffer) => void,
    ): Promise<FFmpegCapture> {
        const fc = new FFmpegCapture();
        fc._launch(displayNum, width, height, onFrame);
        return fc;
    }

    private _launch(
        displayNum: number,
        width:      number,
        height:     number,
        onFrame:    (buf: Buffer) => void,
    ): void {
        const display = `:${displayNum}`;

        const proc = spawn(FFMPEG_BIN, [
            '-loglevel',    'error',            // suppress info/stats noise
            // ── Input ────────────────────────────────────────────────────────
            '-f',           'x11grab',          // X11 screen grabber (uses XShm)
            '-video_size',  `${width}x${height}`,
            '-framerate',   String(TARGET_FPS),
            '-draw_mouse',  '0',                // suppress the X11 cursor overlay
            '-i',           display,
            // ── Output ───────────────────────────────────────────────────────
            '-vcodec',      'mjpeg',            // per-frame JPEG, no inter-frame
            '-q:v',         String(JPEG_QUALITY),
            '-f',           'image2pipe',       // concatenated JPEG stream on stdout
            'pipe:1',
        ], {
            env:   { ...process.env, DISPLAY: display },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this._proc = proc;

        const splitter = new JpegSplitter();
        proc.stdout!.pipe(splitter);

        let prevHash = '';

        splitter.on('data', (jpeg: Buffer) => {
            if (this._stopped) return;

            // Cheap identity check: same pixels → same JPEG bytes from FFmpeg.
            const hash =
                jpeg.subarray(0, 16).toString('hex') +
                jpeg.subarray(-16).toString('hex');
            if (hash === prevHash) return;
            prevHash = hash;

            onFrame(encodeFullFrame(++this._frameId, jpeg));
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
            if (!this._stopped) {
                console.error('[FFmpegCapture]', chunk.toString().trimEnd());
            }
        });

        proc.on('close', (code, signal) => {
            if (!this._stopped) {
                console.error(
                    `[FFmpegCapture] FFmpeg exited unexpectedly — code=${code} signal=${signal}`,
                );
            }
        });

        proc.on('error', (err) => {
            console.error('[FFmpegCapture] failed to spawn FFmpeg:', err.message);
        });
    }

    async stop(): Promise<void> {
        if (this._stopped) return;
        this._stopped = true;
        if (this._proc) {
            this._proc.kill('SIGTERM');
            this._proc = null;
        }
    }
}

/**
 * Transform stream that splits a raw concatenated JPEG byte stream (as output
 * by `ffmpeg -f image2pipe -vcodec mjpeg`) into individual JPEG Buffers.
 *
 * JPEG byte-stuffing guarantees that 0xFF bytes inside entropy-coded data are
 * always followed by 0x00.  Therefore the two-byte sequence 0xFF 0xD9 (EOI
 * marker) is unique — it cannot appear inside a valid JPEG payload — making
 * it a reliable frame boundary.
 */
class JpegSplitter extends Transform {
    private _buf: Buffer = Buffer.alloc(0);

    // Safety cap: if the buffer somehow grows beyond this without a valid JPEG
    // frame being found (e.g. corrupt stream), discard and resync.
    private static readonly MAX_BUF = 8 * 1024 * 1024; // 8 MB

    _transform(chunk: Buffer, _enc: string, cb: TransformCallback): void {
        this._buf = Buffer.concat([this._buf, chunk]);

        while (this._buf.length >= 4) {
            if (this._buf.length > JpegSplitter.MAX_BUF) {
                // Resync: skip to the next SOI marker.
                const next = this._find(0xFF, 0xD8, 0);
                this._buf  = next === -1 ? Buffer.alloc(0) : this._buf.subarray(next);
                if (next === -1) break;
            }

            const soi = this._find(0xFF, 0xD8, 0);
            if (soi === -1) { this._buf = Buffer.alloc(0); break; }

            const eoi = this._find(0xFF, 0xD9, soi + 2);
            if (eoi === -1) {
                // Incomplete frame — trim leading garbage and wait for more data.
                if (soi > 0) this._buf = this._buf.subarray(soi);
                break;
            }

            this.push(Buffer.from(this._buf.subarray(soi, eoi + 2)));
            this._buf = this._buf.subarray(eoi + 2);
        }

        cb();
    }

    _flush(cb: TransformCallback): void {
        this._buf = Buffer.alloc(0);
        cb();
    }

    private _find(b1: number, b2: number, from: number): number {
        const buf = this._buf;
        const end = buf.length - 1;
        for (let i = from; i < end; i++) {
            if (buf[i] === b1 && buf[i + 1] === b2) return i;
        }
        return -1;
    }
}
