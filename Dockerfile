# syntax=docker/dockerfile:1.4
# ── .NET app container (brain / orchestrator) ──────────────────────────────────
# No Xvfb, FFmpeg, or browser binaries here. All browser work lives in the
# sidecar container (./sidecar/Dockerfile).

# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Websete.Speculum.Host/Websete.Speculum.Host.csproj",       "Websete.Speculum.Host/"]
COPY ["Websete.Speculum.Browser/Websete.Speculum.Browser.csproj", "Websete.Speculum.Browser/"]

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore "Websete.Speculum.Host/Websete.Speculum.Host.csproj"

COPY . .

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish "Websete.Speculum.Host/Websete.Speculum.Host.csproj" \
        -c Release -o /app/publish --no-restore

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0

# ── libmsquic — required for HTTP/3 / QUIC (WebTransport) ─────────────────────
# The standard aspnet runtime image does NOT bundle libmsquic.
# Without it, Kestrel silently skips the QUIC listener and WebTransport fails.
# Microsoft ships libmsquic via their own apt repository (packages.microsoft.com).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && curl -sSL https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb \
            -o /tmp/ms-pkg.deb \
    && dpkg -i /tmp/ms-pkg.deb \
    && rm /tmp/ms-pkg.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends libmsquic \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .

# Expose both TCP (HTTP/1.1 + HTTP/2) and UDP (HTTP/3 / QUIC) on the same port.
# The docker-compose ports section must map both protocols: "443:443/tcp" + "443:443/udp".
EXPOSE 443/tcp
EXPOSE 443/udp

ENTRYPOINT ["dotnet", "Websete.Speculum.Host.dll"]
