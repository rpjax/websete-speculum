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

WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080

EXPOSE 8080

ENTRYPOINT ["dotnet", "Websete.Speculum.Host.dll"]
