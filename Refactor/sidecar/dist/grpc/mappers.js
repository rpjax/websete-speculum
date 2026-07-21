"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLaunchOptions = toLaunchOptions;
exports.toDevice = toDevice;
exports.toBrowserState = toBrowserState;
exports.fromBrowserState = fromBrowserState;
exports.toBrowserInput = toBrowserInput;
exports.editingToProto = editingToProto;
/* eslint-disable @typescript-eslint/no-explicit-any */
function toLaunchOptions(req) {
    return {
        width: req.width,
        height: req.height,
        device: req.device ? toDevice(req.device) : undefined,
        scripts: (req.scripts ?? []).map((s) => ({
            position: s.position,
            type: s.type,
            file: s.file,
            content: s.content,
        })),
        allowedNavigationDomains: req.allowedNavigationDomains?.length
            ? req.allowedNavigationDomains
            : undefined,
    };
}
function toDevice(d) {
    return {
        mobile: d.mobile,
        touch: d.touch,
        deviceScaleFactor: d.deviceScaleFactor,
        maxTouchPoints: d.maxTouchPoints,
        userAgentProfile: d.userAgentProfile,
        screenOrientation: d.screenOrientation,
    };
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
    if (!p)
        return null;
    switch (p) {
        case 'mouseMove':
            return { type: 'mousemove', x: msg.mouseMove.x, y: msg.mouseMove.y };
        case 'mouseDown':
            return {
                type: 'mousedown',
                x: msg.mouseDown.x,
                y: msg.mouseDown.y,
                button: msg.mouseDown.button,
            };
        case 'mouseUp':
            return {
                type: 'mouseup',
                x: msg.mouseUp.x,
                y: msg.mouseUp.y,
                button: msg.mouseUp.button,
            };
        case 'wheel':
            return {
                type: 'wheel',
                x: msg.wheel.x,
                y: msg.wheel.y,
                deltaX: msg.wheel.deltaX,
                deltaY: msg.wheel.deltaY,
            };
        case 'keyDown':
            return { type: 'keydown', key: msg.keyDown.key };
        case 'keyUp':
            return { type: 'keyup', key: msg.keyUp.key };
        case 'type':
            return { type: 'type', text: msg.type.text };
        case 'text':
            return { type: 'text', text: msg.text.text, source: msg.text.source };
        case 'touch':
            return {
                type: 'touch',
                phase: msg.touch.phase,
                points: (msg.touch.points ?? []).map((pt) => ({
                    id: pt.id,
                    x: pt.x,
                    y: pt.y,
                    radiusX: pt.radiusX,
                    radiusY: pt.radiusY,
                    force: pt.force,
                })),
                changedIds: msg.touch.changedIds ?? [],
            };
        case 'goback':
            return { type: 'goback' };
        case 'goforward':
            return { type: 'goforward' };
        default:
            return null;
    }
}
function editingToProto(editing) {
    if (!editing)
        return { focused: false };
    return { focused: true, editing };
}
//# sourceMappingURL=mappers.js.map