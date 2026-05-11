namespace Websete.Speculum.Browser;

/// <summary>
/// Minimal JS stealth layer for Camoufox (Firefox-based).
///
/// Camoufox handles the heavy lifting at the binary level — canvas noise,
/// WebGL fingerprint, font metrics, audio context, navigator properties.
/// This script only patches the small set of headless-specific leaks that
/// exist at the Playwright context level and are NOT covered by Camoufox's
/// binary patches.
///
/// Intentionally omitted (would look suspicious on Firefox):
///   • window.chrome            — Chrome-only object
///   • navigator.vendor         — Firefox returns "", Chrome returns "Google Inc."
///   • navigator.userAgentData  — Chrome-specific Client Hints shape
///   • Chrome PDF plugin names  — Firefox has its own plugin model
/// </summary>
internal static class StealthScript
{
    internal const string Js = """
        (() => {
          // ── 1. navigator.webdriver ────────────────────────────────────────────────
          // Safety net: Camoufox patches this at binary level, but Playwright can
          // re-expose it through its own instrumentation layer.
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
          });

          // ── 2. permissions.query ──────────────────────────────────────────────────
          // Headless Firefox returns 'denied' for notification permissions, real
          // Firefox returns 'default'. Normalise to avoid the mismatch.
          if (navigator.permissions?.query) {
            const _orig = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = (params) =>
              params?.name === 'notifications'
                ? Promise.resolve({ state: Notification?.permission ?? 'default', onchange: null })
                : _orig(params);
          }

          // ── 3. navigator — stable cross-browser properties ────────────────────────
          Object.defineProperty(navigator, 'languages',           { get: () => ['en-US', 'en'] });
          Object.defineProperty(navigator, 'platform',            { get: () => 'Win32' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          Object.defineProperty(navigator, 'maxTouchPoints',      { get: () => 0 });

          // ── 4. window.outerWidth / outerHeight ────────────────────────────────────
          // Headless returns 0; a real windowed Firefox returns the inner size +
          // the browser chrome height (~74 px on Windows).
          Object.defineProperty(window, 'outerWidth',  { get: () => window.innerWidth });
          Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 74 });

          // ── 5. document focus + visibility ───────────────────────────────────────
          Object.defineProperty(document, 'hidden',          { get: () => false });
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
          document.hasFocus = () => true;
          document.dispatchEvent(new Event('visibilitychange'));

          // ── 6. screen dimensions ─────────────────────────────────────────────────
          // Headless can expose viewport size as screen size — spoof a real monitor.
          const _def = (prop, val) =>
            Object.defineProperty(screen, prop, { get: () => val, configurable: true });
          _def('width',       1920);
          _def('height',      1080);
          _def('availWidth',  1920);
          _def('availHeight', 1040);
          _def('colorDepth',  24);
          _def('pixelDepth',  24);

          // ── 7. WebGL vendor / renderer ────────────────────────────────────────────
          // Camoufox patches this at binary level; this is a belt-and-suspenders
          // guard for the Playwright context instrumentation layer.
          const patchWebGL = (proto) => {
            const _orig = proto.getParameter;
            proto.getParameter = function(param) {
              if (param === 37445) return 'Intel Inc.';
              if (param === 37446) return 'Intel Iris OpenGL Engine';
              return _orig.call(this, param);
            };
          };
          if (typeof WebGLRenderingContext !== 'undefined')
            patchWebGL(WebGLRenderingContext.prototype);
          if (typeof WebGL2RenderingContext !== 'undefined')
            patchWebGL(WebGL2RenderingContext.prototype);
        })();
        """;
}
