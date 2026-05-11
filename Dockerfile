# syntax=docker/dockerfile:1.4

# ── Stage 1: fetch Camoufox binary ────────────────────────────────────────────
# Python is NOT carried into the final image.
#
# Cache strategy:
#   /root/.cache/pip             → pip wheel cache (BuildKit mount)
#   /root/.cache/camoufox-store  → OUR persistent binary store (BuildKit mount)
#   /root/.cache/camoufox        → camoufox INSTALL_DIR — flat layout, NOT mounted
#
# camoufox fetch calls shutil.rmtree(INSTALL_DIR) before downloading, which
# fails with EBUSY when that path is a BuildKit mountpoint. By mounting at a
# sibling path (-store), camoufox can freely manage its own dir while we cache
# the binary independently.
#
# camoufox extracts files FLAT into INSTALL_DIR (no version subdirectory).
FROM python:3.12-slim AS camoufox

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install camoufox

RUN --mount=type=cache,target=/root/.cache/camoufox-store \
    python3 - <<'PYEOF'
import os, shutil, subprocess, sys

store    = "/root/.cache/camoufox-store"  # our cache (camoufox never touches this)
cf_cache = os.path.expanduser("~/.cache/camoufox")  # camoufox INSTALL_DIR (flat layout)
dst      = "/opt/camoufox"

EXECUTABLES = ("camoufox.launcher", "camoufox", "firefox")

os.makedirs(store, exist_ok=True)

# ── cache hit: restore from store, skip the 713 MB download ──────────────────
if any(os.path.isfile(os.path.join(store, name)) for name in EXECUTABLES):
    print("[cache hit]  Restoring from store — no download needed")
    shutil.copytree(store, dst)

# ── cache miss: fetch, persist to store for future builds ────────────────────
else:
    print("[cache miss] Fetching Camoufox (~713 MB)...")
    subprocess.run([sys.executable, "-m", "camoufox", "fetch"], check=True)

    if not any(os.path.isfile(os.path.join(cf_cache, name)) for name in EXECUTABLES):
        entries = os.listdir(cf_cache) if os.path.isdir(cf_cache) else ["<dir missing>"]
        raise RuntimeError(f"No executable found in {cf_cache} after fetch. Contents: {entries}")

    # store is a mountpoint — use dirs_exist_ok so we don't need to rmtree it
    shutil.copytree(cf_cache, store, dirs_exist_ok=True)
    shutil.copytree(cf_cache, dst)
    print(f"Persisted to store: {store}")

# ── write .executable sentinel (launcher name varies across releases) ─────────
for name in EXECUTABLES:
    if os.path.isfile(os.path.join(dst, name)):
        with open(f"{dst}/.executable", "w") as f:
            f.write(name)
        print(f"Executable: {name}")
        break
else:
    raise RuntimeError(f"No executable found in {dst}. Contents: {os.listdir(dst)}")
PYEOF


# ── Stage 2: browser-base ─────────────────────────────────────────────────────
# Stable layer: .NET runtime + all Firefox/Camoufox system deps + the binary.
# This layer almost never changes, so it stays cached across code rebuilds.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS browser-base

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        ffmpeg \
        libnspr4 \
        libnss3 \
        libdbus-1-3 \
        libdbus-glib-1-2 \
        libgtk-3-0t64 \
        libatk1.0-0t64 \
        libatk-bridge2.0-0t64 \
        libatspi2.0-0t64 \
        libcairo2 \
        libdrm2 \
        libgbm1 \
        libpango-1.0-0 \
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
        libxrandr2 \
        libxrender1 \
        libxkbcommon0 \
        libxtst6 \
        libasound2t64 \
        libcups2t64 \
        fonts-liberation \
        fonts-noto \
        fonts-noto-cjk \
        fontconfig

COPY --from=camoufox /opt/camoufox /opt/camoufox
RUN chmod +x "/opt/camoufox/$(cat /opt/camoufox/.executable)"

ENV Camoufox__ExecutablePath=/opt/camoufox


# ── Stage 3: build .NET app ───────────────────────────────────────────────────
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


# ── Stage 4: final — app on top of browser-base ───────────────────────────────
FROM browser-base

WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080

EXPOSE 8080
ENTRYPOINT ["dotnet", "Websete.Speculum.Host.dll"]
