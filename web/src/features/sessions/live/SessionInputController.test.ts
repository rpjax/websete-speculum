import { describe, expect, it } from 'vitest'
import { SessionInputController } from './SessionInputController'
import { clientToFramePointFill, isLocalBrowserShortcut } from './sessionCoords'

describe('SessionInputController object-fill binding', () => {
  it('maps pointerdown 1:1 from CSS box into frame coords', () => {
    const sent: unknown[] = []
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    // CSS box matches remote viewport aspect after 1:1 sync (scaled UI).
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }),
    })

    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 1280, height: 720 }),
      onInput: (input) => sent.push(input),
    })
    controller.bind(canvas, null)
    controller.setEnabled(true)

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 320,
        clientY: 180,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    )

    expect(sent).toEqual([{ type: 'mousedown', x: 640, y: 360, button: 0 }])
    controller.unbind()
  })

  it('maps near CSS edges (no contain gutter)', () => {
    const sent: unknown[] = []
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }),
    })
    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 1280, height: 720 }),
      onInput: (input) => sent.push(input),
    })
    controller.bind(canvas, null)
    controller.setEnabled(true)

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 160,
        clientY: 10,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'mousedown', button: 0 })
    const down = sent[0] as { x: number; y: number }
    expect(down.x).toBe(640)
    expect(down.y).toBe(30)
    controller.unbind()
  })

  it('does not emit type for printable keydown', () => {
    const sent: unknown[] = []
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    })
    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 100, height: 100 }),
      onInput: (input) => sent.push(input),
    })
    controller.bind(canvas, null)
    controller.setEnabled(true)

    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'a', cancelable: true }),
    )
    expect(sent).toEqual([{ type: 'keydown', key: 'a' }])
    controller.unbind()
  })

  it('maps touch move across the full CSS box', () => {
    const sent: Array<{ type: string; points?: Array<{ x: number; y: number }> }> = []
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }),
    })
    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 1280, height: 720 }),
      onInput: (input) => sent.push(input as { type: string; points?: Array<{ x: number; y: number }> }),
    })
    controller.bind(canvas, null)
    controller.setEnabled(true)

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 160,
        clientY: 120,
        pointerId: 7,
        pointerType: 'touch',
        width: 2,
        height: 2,
        pressure: 0.5,
      }),
    )
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 160,
        clientY: 10,
        pointerId: 7,
        pointerType: 'touch',
        width: 2,
        height: 2,
        pressure: 0.5,
      }),
    )

    const moves = sent.filter((s) => s.type === 'touch')
    expect(moves.length).toBeGreaterThanOrEqual(1)
    controller.unbind()
  })

  it('clientToFramePointFill clamps to frame bounds', () => {
    expect(
      clientToFramePointFill(
        640,
        360,
        { left: 0, top: 0, width: 640, height: 360 },
        1280,
        720,
      ),
    ).toEqual({ x: 1279, y: 719 })
  })

  it('isLocalBrowserShortcut still detects F12', () => {
    expect(isLocalBrowserShortcut('F12', false)).toBe(true)
  })

  it('releases IME nav keys on blur', () => {
    const sent: unknown[] = []
    const canvas = document.createElement('canvas')
    const ime = document.createElement('textarea')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    })
    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 100, height: 100 }),
      onInput: (input) => sent.push(input),
    })
    controller.bind(canvas, ime)
    controller.setEnabled(true)
    ime.focus()

    ime.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft', cancelable: true }),
    )
    ime.dispatchEvent(new FocusEvent('blur', { bubbles: true }))

    expect(sent).toEqual([
      { type: 'keydown', key: 'ArrowLeft' },
      { type: 'keyup', key: 'ArrowLeft' },
    ])
    controller.unbind()
  })

  it('clears composing on IME blur so beforeinput is not blocked', () => {
    const sent: unknown[] = []
    const canvas = document.createElement('canvas')
    const ime = document.createElement('textarea')
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    })
    const controller = new SessionInputController({
      getFrameSize: () => ({ width: 100, height: 100 }),
      onInput: (input) => sent.push(input),
    })
    controller.bind(canvas, ime)
    controller.setEnabled(true)
    ime.focus()

    ime.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    ime.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    ime.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'x',
      }),
    )

    expect(sent).toEqual([{ type: 'text', text: 'x', source: 'insert' }])
    controller.unbind()
  })
})
