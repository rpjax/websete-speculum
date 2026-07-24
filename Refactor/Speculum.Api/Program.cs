using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Speculum.Api.BrowserClients;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Presentation;
using Speculum.Api.Sessions;
using Wolverine;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWolverine();
builder.Services.AddDatabase();
builder.Services.AddJournal();
builder.Services.DiscoverJournalFacts();
builder.Services.AddBrowserSessions();
builder.Services.AddGrpcBrowserClient();
builder.Services.AddPresentation();

var app = builder.Build();

app.Services.EnsureDatabase();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
});

app.MapPresentation();

app.Run();
