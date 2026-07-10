# syntax=docker/dockerfile:1.4

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

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 8080/tcp
ENTRYPOINT ["dotnet", "Websete.Speculum.Host.dll"]
