using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Speculum.Api.BrowserClients;
using Speculum.Api.BrowserSessions;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Wolverine;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWolverine();
builder.Services.AddDatabase();
builder.Services.AddJournal();
builder.Services.DiscoverJournalFacts();
builder.Services.AddBrowserSessions();
builder.Services.AddGrpcBrowserClient();

var app = builder.Build();

app.Services.EnsureDatabase();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
});

app.Run();
