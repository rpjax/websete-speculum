import type {
  BrowserDeviceProfile,
  BrowserInput,
  BrowserLaunchOptions,
  BrowserState,
  BrowserEditingState,
} from '../browser/BrowserSession';
import { validateLaunchViewport } from './validate';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toLaunchOptions(req: any): BrowserLaunchOptions {
  const validated = validateLaunchViewport(req.width, req.height);
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
    device: req.device ? toDevice(req.device) : undefined,
    scripts: Array.isArray(req.scripts)
      ? req.scripts.map((s: any) => ({
          position: s.position,
          type: s.type,
          file: s.file,
          content: s.content,
        }))
      : [],
    allowedNavigationDomains: req.allowedNavigationDomains?.length
      ? req.allowedNavigationDomains
      : undefined,
  };
}

export function toDevice(d: any): BrowserDeviceProfile {
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
    screenOrientation: d.screenOrientation,
  };
}

export function toBrowserState(s: any): BrowserState {
  return {
    cookies: (s.cookies ?? []).map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
    localStorage: (s.localStorage ?? []).map((e: any) => ({
      origin: e.origin,
      key: e.key,
      value: e.value,
    })),
    idbRecords: (s.idbRecords ?? []).map((e: any) => ({
      origin: e.origin,
      databaseName: e.databaseName,
      storeName: e.storeName,
      keyJson: e.keyJson,
      valueJson: e.valueJson,
    })),
    history: (s.history ?? []).map((e: any) => ({
      url: e.url,
      title: e.title,
      visitedAtMs: e.visitedAtMs != null ? Number(e.visitedAtMs) : undefined,
      transitionType: e.transitionType,
      indexOrder: e.indexOrder,
    })),
  };
}

export function fromBrowserState(s: BrowserState): any {
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

export function toBrowserInput(msg: any): BrowserInput {
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
        source: requireString(msg.text?.source, 'text.source'),
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

function parseTouch(touch: any): BrowserInput {
  const phase = requireString(touch?.phase, 'touch.phase') as 'start' | 'move' | 'end' | 'cancel';
  if (!Array.isArray(touch?.points)) {
    throw Object.assign(new Error('touch.points must be an array'), { code: 'INVALID_ARGUMENT' });
  }

  return {
    type: 'touch',
    phase,
    points: touch.points.map((pt: any, index: number) => ({
      id: requireInt(pt?.id, `touch.points[${index}].id`),
      x: requireNumber(pt?.x, `touch.points[${index}].x`),
      y: requireNumber(pt?.y, `touch.points[${index}].y`),
      radiusX: requireNumber(pt?.radiusX, `touch.points[${index}].radiusX`),
      radiusY: requireNumber(pt?.radiusY, `touch.points[${index}].radiusY`),
      force: requireNumber(pt?.force, `touch.points[${index}].force`),
    })),
    changedIds: Array.isArray(touch.changedIds)
      ? touch.changedIds.map((id: unknown, index: number) => requireInt(id, `touch.changedIds[${index}]`))
      : [],
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length) {
    throw Object.assign(new Error(`${field} is required`), { code: 'INVALID_ARGUMENT' });
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Object.assign(new Error(`${field} must be a finite number`), { code: 'INVALID_ARGUMENT' });
  }
  return value;
}

function requireInt(value: unknown, field: string): number {
  const n = requireNumber(value, field);
  if (!Number.isInteger(n)) {
    throw Object.assign(new Error(`${field} must be an integer`), { code: 'INVALID_ARGUMENT' });
  }
  return n;
}

export function editingToProto(editing: BrowserEditingState | null): {
  focused: boolean;
  editing?: BrowserEditingState;
} {
  if (!editing) return { focused: false };
  return { focused: true, editing };
}
