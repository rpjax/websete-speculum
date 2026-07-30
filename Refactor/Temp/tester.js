(() => {
  const RICK =
    "https://images.genius.com/5b7d82ad2cf32fe4c11e03946027da9a.220x261x23.gif";
  const POLL_MS = 200;

  const MEDIA_SELECTOR =
    "img, video, audio, source, embed, object, iframe";

  function patch(el) {
    if (!el || el.nodeType !== 1) return;

    const tag = el.tagName;
    if (tag === "IMG" || tag === "IFRAME" || tag === "EMBED" || tag === "SOURCE") {
      if (el.getAttribute("src") !== RICK) el.setAttribute("src", RICK);
      if (el.src && el.src !== RICK) {
        try {
          el.src = RICK;
        } catch (_) {}
      }
      if (el.hasAttribute("srcset")) el.removeAttribute("srcset");
      if (typeof el.srcset === "string" && el.srcset) {
        try {
          el.srcset = "";
        } catch (_) {}
      }
      return;
    }

    if (tag === "VIDEO" || tag === "AUDIO") {
      el.pause?.();
      if (el.getAttribute("src") !== RICK) el.setAttribute("src", RICK);
      if (el.src && el.src !== RICK) {
        try {
          el.src = RICK;
        } catch (_) {}
      }
      el.querySelectorAll("source").forEach(patch);
      return;
    }

    if (tag === "OBJECT") {
      if (el.getAttribute("data") !== RICK) el.setAttribute("data", RICK);
      if (el.data && el.data !== RICK) {
        try {
          el.data = RICK;
        } catch (_) {}
      }
    }
  }

  function patchAll(root = document) {
    root.querySelectorAll?.(MEDIA_SELECTOR)?.forEach(patch);
    if (root.matches?.(MEDIA_SELECTOR)) patch(root);
  }

  function hookSrc(proto, prop) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.set !== "function") return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        desc.set.call(this, value === RICK ? value : RICK);
      },
    });
  }

  hookSrc(HTMLImageElement.prototype, "src");
  hookSrc(HTMLImageElement.prototype, "srcset");
  hookSrc(HTMLMediaElement.prototype, "src");
  hookSrc(HTMLSourceElement.prototype, "src");
  hookSrc(HTMLSourceElement.prototype, "srcset");
  hookSrc(HTMLIFrameElement.prototype, "src");
  hookSrc(HTMLEmbedElement.prototype, "src");
  hookSrc(HTMLObjectElement.prototype, "data");

  patchAll();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") patch(m.target);
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) patchAll(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "data", "poster"],
  });

  // Continuous sweep — catches SPA rewrites, lazy-load, and attribute races
  // that the observer alone can miss.
  setInterval(() => patchAll(), POLL_MS);
})();
