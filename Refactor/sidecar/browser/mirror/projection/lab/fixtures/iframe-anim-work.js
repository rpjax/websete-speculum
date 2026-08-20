(() => {
  const stage = document.getElementById('stage');
  const box = document.getElementById('box');
  const hud = document.getElementById('hud');
  if (!stage || !box || !hud) return;

  const t0 = performance.now();
  const tick = (now) => {
    const t = (now - t0) / 1000;
    const x = Math.sin(t * 1.7) * 70;
    const y = Math.cos(t * 1.1) * 50;
    const r = t * 120;
    box.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');

  const paint = () => {
    const p = globalThis.__speculumProjection;
    const stats = p && p.telemetry && typeof p.telemetry.emissionStats === 'function' ? p.telemetry.emissionStats() : null;
    if (!stats) {
      hud.textContent = 'ctx —\nemit fps   min —  max —  avg —\nbuild ms   min —  max —  avg —\nwaiting producer';
      return;
    }
    hud.textContent =
      `ctx ${stats.contextId}  n=${stats.samples}\n` +
      `emit fps   min ${fmt(stats.fps.min)}  max ${fmt(stats.fps.max)}  avg ${fmt(stats.fps.avg)}\n` +
      `build ms   min ${fmt(stats.buildMs.min)}  max ${fmt(stats.buildMs.max)}  avg ${fmt(stats.buildMs.avg)}`;
  };

  paint();
  setInterval(paint, 250);
})();
