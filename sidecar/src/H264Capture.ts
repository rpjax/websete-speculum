import { spawn, ChildProcess } from 'child_process';
import { Transform, TransformCallback } from 'stream';
import { encodeH264Frame } from './Protocol';

const FFMPEG_BIN = process.env['FFMPEG_BIN'] ?? 'ffmpeg';
const TARGET_FPS = 60;

/**
 * Captures the Xvfb display using FFmpeg x11grab and encodes to H.264
 * (libx264 ultrafast + zerolatency) for low-latency streaming.
 *
 * Emits MSG_H264 encoded frames via the onFrame callback.
 * start() resolves only after the first frame is produced (FFmpeg is alive).
 */
export class H264Capture {
    private _proc:    ChildProcess | null = null;
    private _stopped: boolean             = false;

    private constructor() {}

    static start(
        displayNum: number,
        width:      number,
        height:     number,
        onFrame:    (buf: Buffer) => void,
    ): Promise<H264Capture> {
        const capture = new H264Capture();

        return new Promise<H264Capture>((resolve, reject) => {
            let settled = false;
            const settle = (fn: () => void): void => {
                if (settled) return;
                settled = true;
                fn();
            };
            capture._spawn(displayNum, width, height,
                (firstBuf) => { onFrame(firstBuf); settle(() => resolve(capture)); },
                (err)      => settle(() => reject(err)),
                onFrame,
            );
        });
    }

    private _spawn(
        displayNum:   number,
        width:        number,
        height:       number,
        onFirstFrame: (buf: Buffer) => void,
        onStartError: (err: Error) => void,
        onFrame:      (buf: Buffer) => void,
    ): void {
        const display = `:${displayNum}`;

        const proc = spawn(FFMPEG_BIN, [
            '-loglevel',     'error',
            // ── Input ───────────────────────────────────────────────────────
            '-f',            'x11grab',
            '-video_size',   `${width}x${height}`,
            '-framerate',    String(TARGET_FPS),
            '-draw_mouse',   '0',
            '-i',            display,
            // ── Codec: libx264, low-latency high-quality ─────────────────────
            '-c:v',          'libx264',
            '-profile:v',    'baseline',     // widest decoder compat (no CABAC, no B-frames)
            '-level:v',      '4.2',          // supports up to 1920×1080@60fps
            '-preset',       'veryfast',     // much better quality than ultrafast, still fast
            '-tune',         'zerolatency',  // no B-frames, no lookahead, no encoder buffers
            '-crf',          '18',           // visually near-lossless (lower = better quality)
            '-maxrate',      '12M',          // cap bitrate to avoid network spikes
            '-bufsize',      '24M',          // 2× maxrate buffer
            // Fixed GOP: keyframe every 2 s, no scene-cut detection
            '-g',            String(TARGET_FPS * 2),
            '-keyint_min',   String(TARGET_FPS * 2),
            '-sc_threshold', '0',
            '-pix_fmt',      'yuv420p',
            // ── Output: raw H.264 Annex B ────────────────────────────────────
            '-f',            'h264',
            'pipe:1',
        ], {
            env:   { ...process.env, DISPLAY: display },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this._proc = proc;

        const framer = new H264AnnexBFramer();
        proc.stdout!.pipe(framer);

        let firstFrame = true;

        framer.on('data', (frame: { data: Buffer; isKeyframe: boolean }) => {
            if (this._stopped) return;
            const encoded = encodeH264Frame(frame.isKeyframe, frame.data);
            if (firstFrame) { firstFrame = false; onFirstFrame(encoded); return; }
            onFrame(encoded);
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
            if (!this._stopped) console.error('[H264Capture]', chunk.toString().trimEnd());
        });

        proc.on('error', (err) => {
            onStartError(new Error(`[H264Capture] Failed to spawn FFmpeg: ${err.message}`));
        });

        proc.on('close', (code, signal) => {
            if (firstFrame) {
                onStartError(new Error(
                    `[H264Capture] FFmpeg exited before producing any frames ` +
                    `(code=${code} signal=${signal}). ` +
                    `Ensure libx264 is installed: apt-get install ffmpeg`,
                ));
            } else if (!this._stopped) {
                console.error(`[H264Capture] FFmpeg exited unexpectedly — code=${code} signal=${signal}`);
            }
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
 * Transform stream: raw H.264 Annex B byte stream → H264Frame objects.
 *
 * Scans for NAL unit boundaries (start codes 00 00 01 or 00 00 00 01).
 * Groups NALs into access units (one complete display frame):
 *   - Keyframe:  SPS(7) + PPS(8) + IDR_slice(5)  → isKeyframe = true
 *   - Delta frame: non-IDR_slice(1)               → isKeyframe = false
 *
 * Uses writableObjectMode=false (receives Buffer chunks from FFmpeg stdout)
 * and readableObjectMode=true (emits { data: Buffer, isKeyframe: boolean }).
 */
class H264AnnexBFramer extends Transform {
    private _buf: Buffer = Buffer.allocUnsafe(512 * 1024);
    private _len: number = 0;

    private _frameNals:  Buffer[]  = [];
    private _isKeyframe: boolean   = false;
    private _hasSlice:   boolean   = false;

    private static readonly MAX_BUF = 16 * 1024 * 1024;

    constructor() {
        super({ writableObjectMode: false, readableObjectMode: true });
    }

    _transform(chunk: Buffer, _enc: string, cb: TransformCallback): void {
        // ── Grow and append ──────────────────────────────────────────────────
        const needed = this._len + chunk.length;
        if (needed > H264AnnexBFramer.MAX_BUF) { this._len = 0; cb(); return; }
        if (needed > this._buf.length) {
            const cap    = Math.min(Math.max(this._buf.length * 2, needed), H264AnnexBFramer.MAX_BUF);
            const newBuf = Buffer.allocUnsafe(cap);
            this._buf.copy(newBuf, 0, 0, this._len);
            this._buf = newBuf;
        }
        chunk.copy(this._buf, this._len);
        this._len += chunk.length;

        // ── Extract complete NAL units ────────────────────────────────────────
        // Each NAL runs from its start code to just before the next start code.
        let consumed = 0;
        while (true) {
            const sc1 = this._findSC(consumed);
            if (!sc1) break;

            const nalDataStart = sc1.pos + sc1.scLen;
            if (nalDataStart >= this._len) break;

            const sc2 = this._findSC(nalDataStart);
            if (!sc2) break;   // NAL not yet complete — need more data

            // Extract NAL data (without start code)
            const nalData = Buffer.from(this._buf.subarray(nalDataStart, sc2.pos));
            const nalType = nalData[0] & 0x1F;

            this._addNal(nalData, nalType);
            consumed = sc2.pos;
        }

        // ── Compact: remove consumed bytes ────────────────────────────────────
        if (consumed > 0) {
            const rem = this._len - consumed;
            if (rem > 0) this._buf.copy(this._buf, 0, consumed, this._len);
            this._len = rem;
        }

        cb();
    }

    _flush(cb: TransformCallback): void {
        // Emit any partially-accumulated last NAL
        const sc = this._findSC(0);
        if (sc) {
            const nalDataStart = sc.pos + sc.scLen;
            if (nalDataStart < this._len) {
                const nalData = Buffer.from(this._buf.subarray(nalDataStart, this._len));
                const nalType = nalData[0] & 0x1F;
                this._addNal(nalData, nalType);
            }
        }
        this._emitFrame();
        cb();
    }

    private _addNal(nalData: Buffer, nalType: number): void {
        if (nalType === 1 || nalType === 5) {
            // Slice NAL — if we already have a slice, the previous frame is complete
            if (this._hasSlice) this._emitFrame();

            // Prepend 4-byte start code and accumulate
            const withSC = Buffer.allocUnsafe(4 + nalData.length);
            withSC[0] = 0; withSC[1] = 0; withSC[2] = 0; withSC[3] = 1;
            nalData.copy(withSC, 4);
            this._frameNals.push(withSC);
            if (nalType === 5) this._isKeyframe = true;
            this._hasSlice = true;

            // With zerolatency, the slice IS the last NAL of the frame — emit now
            this._emitFrame();
        } else {
            // SPS(7), PPS(8), SEI(6), AUD(9) — parameter sets for the NEXT frame
            // If we already have a slice, this starts a new access unit
            if (this._hasSlice) this._emitFrame();

            const withSC = Buffer.allocUnsafe(4 + nalData.length);
            withSC[0] = 0; withSC[1] = 0; withSC[2] = 0; withSC[3] = 1;
            nalData.copy(withSC, 4);
            this._frameNals.push(withSC);
        }
    }

    private _emitFrame(): void {
        if (this._frameNals.length === 0) return;
        const data       = Buffer.concat(this._frameNals);
        const isKeyframe = this._isKeyframe;
        this._frameNals  = [];
        this._isKeyframe = false;
        this._hasSlice   = false;
        this.push({ data, isKeyframe });
    }

    /**
     * Finds the next H.264 Annex B start code (00 00 01 or 00 00 00 01)
     * starting at position `from`.
     */
    private _findSC(from: number): { pos: number; scLen: number } | null {
        const end = this._len - 2;
        for (let i = from; i < end; i++) {
            if (this._buf[i] !== 0 || this._buf[i + 1] !== 0) { i++; continue; }
            // Have 00 00 at i, i+1
            if (i + 3 < this._len && this._buf[i + 2] === 0 && this._buf[i + 3] === 1) {
                return { pos: i, scLen: 4 };   // 00 00 00 01
            }
            if (this._buf[i + 2] === 1) {
                return { pos: i, scLen: 3 };   // 00 00 01
            }
        }
        return null;
    }
}
