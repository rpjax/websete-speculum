# syntax=docker/dockerfile:1.4
# Build from Refactor/: docker build -f Speculum.Api/Dockerfile .

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Speculum.Api/Speculum.Api.csproj Speculum.Api/
COPY proto/ proto/

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore Speculum.Api/Speculum.Api.csproj

COPY Speculum.Api/ Speculum.Api/

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish Speculum.Api/Speculum.Api.csproj \
        -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0

# WebTransport needs HTTP/3 (QUIC). Kestrel silently drops H3 without libmsquic on Linux.
ADD https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb /tmp/packages-microsoft-prod.deb
RUN dpkg -i /tmp/packages-microsoft-prod.deb \
    && rm /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl libmsquic \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 8080/tcp
EXPOSE 8443/tcp
EXPOSE 8443/udp
ENTRYPOINT ["dotnet", "Speculum.Api.dll"]
