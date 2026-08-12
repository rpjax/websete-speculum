"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLaunchOptions = toLaunchOptions;
exports.toDevice = toDevice;
exports.toBrowserState = toBrowserState;
exports.fromBrowserState = fromBrowserState;
exports.toBrowserInput = toBrowserInput;
exports.editingToProto = editingToProto;
const validate_1 = require("./validate");
/* eslint-disable @typescript-eslint/no-explicit-any */
function toLaunchOptions(req) {
    const viewportPolicy = (0, validate_1.requireViewportPolicy)(req);
    const validated = (0, validate_1.validateLaunchViewport)(req.width, req.height, viewportPolicy);
    if (!validated.ok) {
        throw Object.assign(new Error(validated.message), {
            code: 'INVALID_ARGUMENT',
            errorCode: validated.errorCode,
            phase: 'validate',
        });
    }
    return {
        width: validated.width,
        height: validated.height,
        viewportPolicy,
        locale: requireString(req.locale, 'locale'),
        language: requireString(req.language, 'language'),
        timeZoneId: requireString(req.timezoneId, 'timezoneId'),
        colorScheme: requireColorScheme(req.colorScheme),
        geolocation: req.geolocation
            ? {
                latitude: requireLatitude(req.geolocation.latitude),
                longitude: requireLongitude(req.geolocation.longitude),
                accuracy: requireAccuracy(req.geolocation.accuracy),
            }
            : undefined,
        device: req.device ? toDevice(req.device) : undefined,
        scripts: Array.isArray(req.scripts)
            ? req.scripts.map((s) => ({
                position: s.position,
                type: s.type,
                file: s.file,
                content: s.content ?? '',
                remoteUrl: s.remoteUrl || s.remote_url || undefined,
                targetRules: toTargetRules(s),
            }))
            : [],
        allowedNavigationDomains: req.allowedNavigationDomains?.length
            ? req.allowedNavigationDomains
            : undefined,
        screencastMaxEncodeScale: resolveScreencastMaxEncodeScale(req.screencastMaxEncodeScale ?? req.screencast_max_encode_scale),
        mirrorMode: resolveMirrorMode(req.mirrorMode ?? req.mirror_mode),
        pageProjectionDiffQueueCapacity: resolvePageProjectionDiffQueueCapacity(req.pageProjectionDiffQueueCapacity ?? req.page_projection_diff_queue_capacity),
        frameRateHz: resolvePositiveIntOrUndefined(req.frameRateHz ?? req.frame_rate_hz),
        maxFrameBytes: resolvePositiveIntOrUndefined(req.maxFrameBytes ?? req.max_frame_bytes),
        browserPoolSize: resolveNonNegativeIntOrUndefined(req.browserPoolSize ?? req.browser_pool_size),
        browserPoolRefillPerSec: resolvePositiveIntOrUndefined(req.browserPoolRefillPerSec ?? req.browser_pool_refill_per_sec),
        frameRateLadder: resolveRateLadder(req.frameRateLadder ?? req.frame_rate_ladder),
        hiddenRateHz: resolvePositiveIntOrUndefined(req.hiddenRateHz ?? req.hidden_rate_hz),
        rateRecoverMs: resolvePositiveIntOrUndefined(req.rateRecoverMs ?? req.rate_recover_ms),
        frameStallMs: resolvePositiveIntOrUndefined(req.frameStallMs ?? req.frame_stall_ms),
        establishChunkBytes: resolvePositiveIntOrUndefined(req.establishChunkBytes ?? req.establish_chunk_bytes),
        mirrorMaxBytes: resolvePositiveIntOrUndefined(req.mirrorMaxBytes ?? req.mirror_max_bytes),
        assetCacheL1MaxBytes: resolvePositiveIntOrUndefined(req.assetCacheL1MaxBytes ?? req.asset_cache_l1_max_bytes),
        assetPriorityViewportPx: resolvePositiveIntOrUndefined(req.assetPriorityViewportPx ?? req.asset_priority_viewport_px),
        aggregateIntervalMs: resolvePositiveIntOrUndefined(req.aggregateIntervalMs ?? req.aggregate_interval_ms),
    };
}
function resolveRateLadder(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return undefined;
    const out = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n));
    return out.length > 0 ? out : undefined;
}
/** §5.16 knobs relayed verbatim when positive; 0/absent lets the sidecar default apply. */
function resolvePositiveIntOrUndefined(raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
/** Like {@link resolvePositiveIntOrUndefined} but 0 is a meaningful value (pool disabled). */
function resolveNonNegativeIntOrUndefined(raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}
function resolveMirrorMode(raw) {
    return raw === 'pageProjection' ? 'pageProjection' : 'videoStreaming';
}
function resolvePageProjectionDiffQueueCapacity(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 64) {
        return 8192;
    }
    return Math.min(65_536, Math.max(64, Math.floor(n)));
}
function resolveScreencastMaxEncodeScale(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return 2;
    }
    return Math.min(2, Math.max(1, n));
}
function toDevice(d) {
    if (d.deviceScaleFactor === undefined || d.deviceScaleFactor <= 0) {
        throw Object.assign(new Error('device.deviceScaleFactor must be a positive number'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    if (d.maxTouchPoints === undefined || d.maxTouchPoints < 0) {
        throw Object.assign(new Error('device.maxTouchPoints must be provided and non-negative'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    return {
        mobile: !!d.mobile,
        touch: !!d.touch,
        deviceScaleFactor: d.deviceScaleFactor,
        maxTouchPoints: d.maxTouchPoints,
        userAgentProfile: d.userAgentProfile,
        deviceCategory: d.deviceCategory,
        screenOrientation: d.screenOrientation,
    };
}
function toTargetRules(s) {
    return Array.isArray(s.targetRules)
        ? s.targetRules.map((rule) => ({
            domain: {
                scope: String(rule.domain?.scope ?? ''),
                labels: Array.isArray(rule.domain?.labels)
                    ? rule.domain.labels.map((label) => ({
                        match: String(label.match ?? ''),
                        value: String(label.value ?? ''),
                    }))
                    : [],
            },
            path: {
                scope: String(rule.path?.scope ?? ''),
                matchType: String(rule.path?.matchType ?? ''),
                segments: Array.isArray(rule.path?.segments)
                    ? rule.path.segments.map((segment) => ({
                        match: String(segment.match ?? ''),
                        value: String(segment.value ?? ''),
                    }))
                    : [],
            },
        }))
        : [];
}
function toBrowserState(s) {
    return {
        cookies: (s.cookies ?? []).map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
        })),
        localStorage: (s.localStorage ?? []).map((e) => ({
            origin: e.origin,
            key: e.key,
            value: e.value,
        })),
        idbRecords: (s.idbRecords ?? []).map((e) => ({
            origin: e.origin,
            databaseName: e.databaseName,
            storeName: e.storeName,
            keyJson: e.keyJson,
            valueJson: e.valueJson,
        })),
        history: (s.history ?? []).map((e) => ({
            url: e.url,
            title: e.title,
            visitedAtMs: e.visitedAtMs != null ? Number(e.visitedAtMs) : undefined,
            transitionType: e.transitionType,
            indexOrder: e.indexOrder,
        })),
    };
}
function fromBrowserState(s) {
    return {
        cookies: s.cookies.map((c) => ({ ...c })),
        localStorage: s.localStorage.map((e) => ({ ...e })),
        idbRecords: s.idbRecords.map((e) => ({ ...e })),
        history: s.history.map((e) => ({
            ...e,
            visitedAtMs: e.visitedAtMs != null ? String(e.visitedAtMs) : undefined,
        })),
    };
}
function toBrowserInput(msg) {
    const p = msg.payload;
    if (!p) {
        throw Object.assign(new Error('input payload is required'), { code: 'INVALID_ARGUMENT' });
    }
    switch (p) {
        case 'mouseMove':
            return { type: 'mousemove', x: requireNumber(msg.mouseMove?.x, 'mouseMove.x'), y: requireNumber(msg.mouseMove?.y, 'mouseMove.y') };
        case 'mouseDown':
            return {
                type: 'mousedown',
                x: requireNumber(msg.mouseDown?.x, 'mouseDown.x'),
                y: requireNumber(msg.mouseDown?.y, 'mouseDown.y'),
                button: requireInt(msg.mouseDown?.button, 'mouseDown.button'),
            };
        case 'mouseUp':
            return {
                type: 'mouseup',
                x: requireNumber(msg.mouseUp?.x, 'mouseUp.x'),
                y: requireNumber(msg.mouseUp?.y, 'mouseUp.y'),
                button: requireInt(msg.mouseUp?.button, 'mouseUp.button'),
            };
        case 'wheel':
            return {
                type: 'wheel',
                x: requireNumber(msg.wheel?.x, 'wheel.x'),
                y: requireNumber(msg.wheel?.y, 'wheel.y'),
                deltaX: requireNumber(msg.wheel?.deltaX, 'wheel.deltaX'),
                deltaY: requireNumber(msg.wheel?.deltaY, 'wheel.deltaY'),
            };
        case 'keyDown':
            return { type: 'keydown', key: requireString(msg.keyDown?.key, 'keyDown.key') };
        case 'keyUp':
            return { type: 'keyup', key: requireString(msg.keyUp?.key, 'keyUp.key') };
        case 'type':
            return { type: 'type', text: requireString(msg.type?.text, 'type.text') };
        case 'text':
            return {
                type: 'text',
                text: requireString(msg.text?.text, 'text.text'),
                // Empty source is valid on the API wire — default like insertText callers.
                source: typeof msg.text?.source === 'string' && msg.text.source.length > 0
                    ? msg.text.source
                    : 'insert',
            };
        case 'touch':
            return parseTouch(msg.touch);
        case 'goback':
            return { type: 'goback' };
        case 'goforward':
            return { type: 'goforward' };
        default:
            throw Object.assign(new Error(`unsupported input payload: ${String(p)}`), {
                code: 'INVALID_ARGUMENT',
            });
    }
}
function parseTouch(touch) {
    const phase = requireString(touch?.phase, 'touch.phase');
    if (!Array.isArray(touch?.points)) {
        throw Object.assign(new Error('touch.points must be an array'), { code: 'INVALID_ARGUMENT' });
    }
    return {
        type: 'touch',
        phase,
        points: touch.points.map((pt, index) => ({
            id: requireInt(pt?.id, `touch.points[${index}].id`),
            x: requireNumber(pt?.x, `touch.points[${index}].x`),
            y: requireNumber(pt?.y, `touch.points[${index}].y`),
            radiusX: requireNumber(pt?.radiusX, `touch.points[${index}].radiusX`),
            radiusY: requireNumber(pt?.radiusY, `touch.points[${index}].radiusY`),
            force: requireNumber(pt?.force, `touch.points[${index}].force`),
        })),
        changedIds: Array.isArray(touch.changedIds)
            ? touch.changedIds.map((id, index) => requireInt(id, `touch.changedIds[${index}]`))
            : [],
    };
}
function requireString(value, field) {
    if (typeof value !== 'string' || !value.length) {
        throw Object.assign(new Error(`${field} is required`), { code: 'INVALID_ARGUMENT' });
    }
    return value;
}
function requireNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw Object.assign(new Error(`${field} must be a finite number`), { code: 'INVALID_ARGUMENT' });
    }
    return value;
}
function requireInt(value, field) {
    const n = requireNumber(value, field);
    if (!Number.isInteger(n)) {
        throw Object.assign(new Error(`${field} must be an integer`), { code: 'INVALID_ARGUMENT' });
    }
    return n;
}
function requireLatitude(value) {
    const latitude = requireNumber(value, 'geolocation.latitude');
    if (latitude < -90 || latitude > 90) {
        throw Object.assign(new Error('geolocation.latitude must be between -90 and 90'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    return latitude;
}
function requireLongitude(value) {
    const longitude = requireNumber(value, 'geolocation.longitude');
    if (longitude < -180 || longitude > 180) {
        throw Object.assign(new Error('geolocation.longitude must be between -180 and 180'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    return longitude;
}
function requireAccuracy(value) {
    const accuracy = requireNumber(value, 'geolocation.accuracy');
    if (accuracy < 0) {
        throw Object.assign(new Error('geolocation.accuracy must be non-negative'), {
            code: 'INVALID_ARGUMENT',
        });
    }
    return accuracy;
}
function requireColorScheme(value) {
    const colorScheme = requireString(value, 'colorScheme');
    if (colorScheme !== 'light' && colorScheme !== 'dark' && colorScheme !== 'no-preference') {
        throw Object.assign(new Error('colorScheme must be light, dark, or no-preference'), { code: 'INVALID_ARGUMENT' });
    }
    return colorScheme;
}
function editingToProto(editing) {
    if (!editing)
        return { focused: false };
    return { focused: true, editing };
}
//# sourceMappingURL=mappers.js.map