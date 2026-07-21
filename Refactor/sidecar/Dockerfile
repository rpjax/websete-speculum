# Speculum sidecar — Patchright BrowserSession + gRPC host
# Build from Refactor/: docker build -f sidecar/Dockerfile .

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    CHROME_EXECUTABLE=/usr/bin/google-chrome \
    SPECULUM_GRPC_PORT=50051 \
    SPECULUM_HEALTH_PORT=3001

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      fonts-liberation \
      fonts-noto-color-emoji \
      fonts-noto-cjk \
      xvfb \
      x11-xserver-utils \
      matchbox-window-manager \
      mesa-utils \
      libnss3 \
      libatk-bridge2.0-0 \
      libgtk-3-0 \
      libgbm1 \
      libasound2 \
      libxshmfence1 \
      libdrm2 \
      libxkbcommon0 \
      kmod \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && (apt-get install -y --no-install-recommends v4l2loopback-dkms || true) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY sidecar/package.json sidecar/package-lock.json ./
RUN npm ci

COPY sidecar/tsconfig.json ./
COPY sidecar/browser ./browser
COPY sidecar/grpc ./grpc
COPY sidecar/host ./host
COPY sidecar/index.ts sidecar/smoke.ts sidecar/smoke-remote.ts sidecar/unit.ts ./
COPY proto /proto

RUN npm run build \
 && mkdir -p /app/../proto \
 && cp /proto/browser_session.proto /app/../proto/browser_session.proto

EXPOSE 50051 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/ready || exit 1

CMD ["node", "dist/index.js"]
