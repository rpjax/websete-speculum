/**
 * YouTube-mobile-style lab chrome: surface stage + bottom investigation sheet.
 */

export type SheetSnap = 'collapsed' | 'peek' | 'expanded';

const SHEET_SNAP_KEY = 'speculum.lab.sheetSnap';
const SHEET_H_KEY = 'speculum.lab.sheetH';

export type LabShellOptions = {
  main: HTMLElement;
  sheet: HTMLElement;
  grabber: HTMLElement;
  hud: HTMLElement;
  hudToggle: HTMLElement;
  hudBody: HTMLElement;
  hudMore?: HTMLElement;
  onSnapChange?: (snap: SheetSnap) => void;
};

export type LabShell = {
  setSnap: (snap: SheetSnap, persist?: boolean) => void;
  getSnap: () => SheetSnap;
  expandForTab: (tab: string) => void;
  collapse: () => void;
};

function readPersistedSnap(): SheetSnap | null {
  try {
    const v = localStorage.getItem(SHEET_SNAP_KEY);
    if (v === 'collapsed' || v === 'peek' || v === 'expanded') return v;
  } catch {
    /* */
  }
  return null;
}

function snapHeight(snap: SheetSnap, viewportH: number): number {
  const minBar = 96;
  const max = Math.floor(viewportH * 0.92);
  if (snap === 'collapsed') return minBar;
  if (snap === 'peek') return Math.min(max, Math.max(minBar + 80, Math.floor(viewportH * 0.42)));
  return Math.min(max, Math.max(minBar + 120, Math.floor(viewportH * 0.78)));
}

export function initLabShell(opts: LabShellOptions): LabShell {
  let snap: SheetSnap = readPersistedSnap() ?? 'peek';
  let dragging = false;
  let dragStartY = 0;
  let dragStartH = 0;

  function clampHeight(px: number): number {
    const vh = window.innerHeight;
    const min = 96;
    const max = Math.floor(vh * 0.92);
    return Math.min(max, Math.max(min, Math.round(px)));
  }

  function applyHeight(px: number): void {
    const h = clampHeight(px);
    opts.main.style.setProperty('--sheet-h', `${h}px`);
    opts.sheet.dataset.snap = snap;
  }

  function persistSnap(): void {
    try {
      localStorage.setItem(SHEET_SNAP_KEY, snap);
      const h = opts.sheet.getBoundingClientRect().height;
      if (Number.isFinite(h)) localStorage.setItem(SHEET_H_KEY, String(Math.round(h)));
    } catch {
      /* */
    }
  }

  function nearestSnap(h: number, vh: number): SheetSnap {
    const collapsed = snapHeight('collapsed', vh);
    const peek = snapHeight('peek', vh);
    const expanded = snapHeight('expanded', vh);
    const dist = (target: number) => Math.abs(h - target);
    const dC = dist(collapsed);
    const dP = dist(peek);
    const dE = dist(expanded);
    if (dC <= dP && dC <= dE) return 'collapsed';
    if (dP <= dE) return 'peek';
    return 'expanded';
  }

  function setSnap(next: SheetSnap, persist = true): void {
    snap = next;
    applyHeight(snapHeight(snap, window.innerHeight));
    opts.onSnapChange?.(snap);
    if (persist) persistSnap();
  }

  function setHudCollapsed(collapsed: boolean): void {
    opts.hud.dataset.collapsed = collapsed ? 'true' : 'false';
    opts.hudToggle.textContent = collapsed ? '▸' : '▾';
    opts.hudToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  opts.hudToggle.addEventListener('click', () => {
    const collapsed = opts.hud.dataset.collapsed === 'true';
    setHudCollapsed(!collapsed);
  });

  opts.hudMore?.addEventListener('click', () => {
    const open = opts.hud.dataset.more === 'true';
    opts.hud.dataset.more = open ? 'false' : 'true';
    opts.hudMore?.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (!open) setHudCollapsed(false);
  });

  // Tap surface (not hud) toggles hud compact — delegated from main after boot.
  opts.hud.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  const onPointerMove = (ev: PointerEvent) => {
    if (!dragging) return;
    const dy = dragStartY - ev.clientY;
    applyHeight(dragStartH + dy);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    opts.grabber.classList.remove('is-dragging');
    const h = opts.sheet.getBoundingClientRect().height;
    snap = nearestSnap(h, window.innerHeight);
    applyHeight(snapHeight(snap, window.innerHeight));
    opts.onSnapChange?.(snap);
    persistSnap();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  opts.grabber.addEventListener('pointerdown', (ev) => {
    dragging = true;
    dragStartY = ev.clientY;
    dragStartH = opts.sheet.getBoundingClientRect().height;
    opts.grabber.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    ev.preventDefault();
  });

  // Double-tap grabber cycles snap.
  let lastGrabTap = 0;
  opts.grabber.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastGrabTap < 320) {
      setSnap(snap === 'collapsed' ? 'peek' : snap === 'peek' ? 'expanded' : 'collapsed');
    }
    lastGrabTap = now;
  });

  window.addEventListener('resize', () => {
    applyHeight(snapHeight(snap, window.innerHeight));
  });

  setHudCollapsed(false);
  setSnap(snap, false);

  return {
    setSnap,
    getSnap: () => snap,
    expandForTab: (tab: string) => {
      if (tab === 'Runs' || tab === 'Progress') setSnap('expanded');
      else if (snap === 'collapsed') setSnap('peek');
    },
    collapse: () => setSnap('collapsed'),
  };
}
