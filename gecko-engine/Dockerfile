# Speculum Gecko sidecar — orchestrator + supervisor + Firefox dist
# Build from repo root:
#   docker build -f gecko-engine/Dockerfile .
#
# gecko-engine/gecko-dist/ must contain a published Firefox dist (dist/bin).
# Do not run mach inside this image.

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY gecko-engine/supervisor/Directory.Build.props gecko-engine/supervisor/Directory.Build.props
COPY gecko-engine/supervisor/Speculum.Gecko.sln gecko-engine/supervisor/Speculum.Gecko.sln
COPY gecko-engine/supervisor/src/Speculum.Gecko.Abi gecko-engine/supervisor/src/Speculum.Gecko.Abi
COPY gecko-engine/supervisor/src/Speculum.Supervisor gecko-engine/supervisor/src/Speculum.Supervisor
COPY gecko-engine/supervisor/src/Speculum.Orchestrator gecko-engine/supervisor/src/Speculum.Orchestrator

WORKDIR /src/gecko-engine/supervisor
RUN dotnet publish src/Speculum.Supervisor/Speculum.Supervisor.csproj \
      -c Release -r linux-x64 --self-contained true -o /out \
    && dotnet publish src/Speculum.Orchestrator/Speculum.Orchestrator.csproj \
      -c Release -r linux-x64 --self-contained true -o /out

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive \
    SPECULUM_ORCHESTRATOR_PORT=4100 \
    SPECULUM_SUPERVISOR_BIN=/opt/speculum/bin/speculum-supervisor \
    SPECULUM_BROWSER_BIN=/opt/speculum/firefox/firefox \
    SPECULUM_ORCHESTRATOR_DATA=/var/lib/speculum/sessions \
    SPECULUM_ORCHESTRATOR_MAX_PAIRS=8 \
    SPECULUM_ORCHESTRATOR_DETACH_SECONDS=3 \
    MOZ_DISABLE_CONTENT_SANDBOX=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-noto-cjk \
      libgtk-3-0 \
      libdbus-glib-1-2 \
      libxt6 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libasound2 \
      libnss3 \
      libatk-bridge2.0-0 \
      libdrm2 \
      libgbm1 \
      libxshmfence1 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libcups2 \
      libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/speculum/bin /opt/speculum/firefox /var/lib/speculum/sessions

COPY --from=build /out/speculum-orchestrator /opt/speculum/bin/speculum-orchestrator
COPY --from=build /out/speculum-supervisor /opt/speculum/bin/speculum-supervisor
COPY gecko-engine/gecko-dist/firefox-dist.tar.gz /tmp/firefox-dist.tar.gz
RUN tar -xzf /tmp/firefox-dist.tar.gz -C /opt/speculum/firefox \
    && rm /tmp/firefox-dist.tar.gz \
    && chmod +x /opt/speculum/firefox/firefox \
    && test -x /opt/speculum/firefox/firefox

EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -sf http://127.0.0.1:4100/ready || exit 1

WORKDIR /opt/speculum
ENTRYPOINT ["/opt/speculum/bin/speculum-orchestrator"]
