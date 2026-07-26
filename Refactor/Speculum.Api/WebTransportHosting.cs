using System.Net;
using System.Net.Quic;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Speculum.Api.Presentation.Sessions;

namespace Speculum.Api;

internal static class WebTransportHosting
{
    public const string PortEnvironmentVariable = "SPECULUM_WEBTRANSPORT_PORT";

    /// <summary>
    /// When <see cref="PortEnvironmentVariable"/> is set, listens for HTTPS + HTTP/3
    /// with a hash-pinnable WebTransport certificate and exposes the pin at
    /// <c>/health/webtransport-cert</c> (reachable over the plain HTTP edge).
    /// </summary>
    public static WebTransportDevCertificate? Configure(WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        var raw = Environment.GetEnvironmentVariable(PortEnvironmentVariable)
            ?? builder.Configuration[PortEnvironmentVariable];
        if (!int.TryParse(raw, out var port) || port <= 0)
            return null;

        if (!QuicListener.IsSupported)
        {
            throw new InvalidOperationException(
                "SPECULUM_WEBTRANSPORT_PORT is set but QUIC/HTTP/3 is unavailable. " +
                "On Linux install libmsquic in the container image (see Speculum.Api/Dockerfile).");
        }

        var certificate = WebTransportDevCertificate.Create();
        builder.Services.AddSingleton(certificate);
        builder.Services.AddSingleton(new WebTransportListenOptions(port));

        // Listen() replaces ASPNETCORE_URLS — keep the plain HTTP edge for Traefik/health.
        var httpPort = ResolveHttpPort(builder.Configuration);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Any, httpPort, listen =>
            {
                listen.Protocols = HttpProtocols.Http1AndHttp2;
            });
            options.Listen(IPAddress.Any, port, listen =>
            {
                listen.Protocols = HttpProtocols.Http1AndHttp2AndHttp3;
                listen.UseHttps(certificate.Certificate);
            });
        });

        return certificate;
    }

    private static int ResolveHttpPort(IConfiguration configuration)
    {
        var urls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS")
            ?? configuration["ASPNETCORE_URLS"]
            ?? "http://0.0.0.0:8080";
        foreach (var part in urls.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!part.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                continue;
            if (Uri.TryCreate(part, UriKind.Absolute, out var uri) && uri.Port > 0)
                return uri.Port;
        }

        return 8080;
    }

    public static void MapCertificateEndpoint(WebApplication app, WebTransportDevCertificate? certificate)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (certificate is null)
            return;

        var listen = app.Services.GetService<WebTransportListenOptions>();
        app.Logger.LogInformation(
            "WebTransport HTTPS+HTTP/3 listening on :{Port} (QUIC supported={QuicSupported})",
            listen?.Port,
            QuicListener.IsSupported);

        app.MapGet("/health/webtransport-cert", () => Microsoft.AspNetCore.Http.Results.Json(new
        {
            algorithm = "sha-256",
            sha256 = certificate.Sha256Base64,
            port = listen?.Port.ToString(),
            quic = QuicListener.IsSupported,
        }));
    }

    private sealed record WebTransportListenOptions(int Port);
}
