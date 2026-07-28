using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Speculum.Api;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations;
using Speculum.Api.Configurations.Services;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Presentation;
using Speculum.Api.Presentation.Auth;
using Speculum.Api.Profiles;
using Speculum.Api.Sessions;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Telemetry;
using Wolverine;

AppContext.SetSwitch(
    "Microsoft.AspNetCore.Server.Kestrel.Experimental.WebTransportAndH3Datagrams",
    true);

var builder = WebApplication.CreateBuilder(args);

var webTransportCertificate = WebTransportHosting.Configure(builder);

builder.Host.UseWolverine();
builder.Services.AddEngineConfiguration();
builder.Services.AddDatabase();
builder.Services.AddJournal();
builder.Services.DiscoverJournalFacts();
builder.Services.AddProfiles();
builder.Services.AddBrowserSessions();
builder.Services.AddGrpcBrowserClient();
builder.Services.AddTelemetry();
builder.Services.AddSingleton<IUrlResolver, UrlResolver>();
builder.Services.AddScoped<ISessionService, SessionService>();
builder.Services.AddPresentation();

var app = builder.Build();

app.Services.EnsureDatabase();
await app.Services.GetRequiredService<IConfigurationLoadService>()
    .LoadAndApplyAsync()
    .ConfigureAwait(false);

app.UseSpeculumApiAuth();

// Process-up only — Docker/Traefik depends_on must not wait on pending-config,
// or configuration APIs stay unreachable when mandatory sections are incomplete.
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false,
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
});

WebTransportHosting.MapCertificateEndpoint(app, webTransportCertificate);

app.MapPresentation();

app.Run();
