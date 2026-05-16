# syntax=docker/dockerfile:1.4
# ── Sidecar: Chrome non-headless on Xvfb, Patchright, CDP screencast ──────────

FROM node:22-slim

# ── System dependencies ────────────────────────────────────────────────────────
# Installs:
#   ca-certificates, curl, gnupg       — for adding the Chrome apt repo
#   xvfb                               — virtual X11 framebuffer (one per session)
#   matchbox-window-manager            — kiosk WM (real focus + damage events for Chrome)
#   xdotool                            — X11 native input injection (mouse + keyboard)
#   mesa-utils, libgl1-mesa-dri, libgl1 — Mesa software renderer (llvmpipe / swiftshader fallback)
#   fonts-liberation, fonts-noto, fonts-noto-cjk, fontconfig — broad font coverage
#   remaining lib* packages            — Chrome runtime deps on Debian bookworm slim
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        xvfb \
        matchbox-window-manager \
        xdotool \
        ffmpeg \
        x11-xserver-utils \
        mesa-utils \
        libgl1-mesa-dri \
        libgl1 \
        fonts-liberation \
        fonts-noto \
        fonts-noto-cjk \
        fontconfig \
        libnss3 \
        libnspr4 \
        libdbus-1-3 \
        libdbus-glib-1-2 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libatspi2.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcb-shm0 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxtst6 \
        libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

# ── Install Google Chrome stable ──────────────────────────────────────────────
# google-chrome-stable installs to /usr/bin/google-chrome (symlink) and
# /usr/bin/google-chrome-stable. CHROME_EXECUTABLE points to the symlink.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Verify Chrome is where we expect it (fails the build fast if the path is wrong).
RUN google-chrome --version

# ── Node app ───────────────────────────────────────────────────────────────────
WORKDIR /app

# Install devDependencies too so tsc is available for the build step.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

# Install only Playwright system dependencies — NOT the Chromium browser binary.
# We use the system google-chrome-stable installed above.
# This ensures any library gaps in libnss3, libgbm1, etc. are covered by
# Patchright's known dependency list without downloading a second Chromium.
RUN npx patchright install-deps chromium

COPY . .
RUN npm run build

# Prune devDependencies after build (tsc no longer needed at runtime).
RUN npm prune --omit=dev

# ── Runtime ───────────────────────────────────────────────────────────────────
ENV NODE_ENV=production \
    CHROME_EXECUTABLE=/usr/bin/google-chrome \
    SIDECAR_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
