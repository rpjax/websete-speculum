using Speculum.Api.Composition;
using Speculum.Api.Config.Store;
using Speculum.Api.Scripts;
using Speculum.Api.BrowserPersistence;

var builder = WebApplication.CreateBuilder(args);

builder.AddSpeculumServices();

var app = builder.Build();

var configStore = app.Services.GetRequiredService<ISpeculumConfigStore>();
var sessionStore = app.Services.GetRequiredService<IBrowserSessionStore>();
var scriptStore = app.Services.GetRequiredService<IInjectedScriptStore>();

await scriptStore.InitializeAsync();
await sessionStore.InitializeAsync();
await configStore.InitializeAsync();

app.UseSpeculumPipeline();

app.Run();
