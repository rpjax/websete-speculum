using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Presentation;
using Speculum.Api.Sessions;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Wolverine;

AppContext.SetSwitch(
    "Microsoft.AspNetCore.Server.Kestrel.Experimental.WebTransportAndH3Datagrams",
    true);

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWolverine();
builder.Services.AddEngineConfiguration();
builder.Services.AddDatabase();
builder.Services.AddJournal();
builder.Services.DiscoverJournalFacts();
builder.Services.AddBrowserSessions();
builder.Services.AddGrpcBrowserClient();
builder.Services.AddSingleton<IUrlResolver, UrlResolver>();
builder.Services.AddScoped<ISessionService, SessionService>();
builder.Services.AddPresentation();

var app = builder.Build();

app.Services.EnsureDatabase();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
});

app.MapPresentation();

app.Run();
