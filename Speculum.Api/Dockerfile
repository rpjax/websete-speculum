# syntax=docker/dockerfile:1.4

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Speculum.Api.csproj", "./"]

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore "Speculum.Api.csproj"

COPY . .

RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish "Speculum.Api.csproj" \
        -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 8080/tcp
ENTRYPOINT ["dotnet", "Speculum.Api.dll"]
