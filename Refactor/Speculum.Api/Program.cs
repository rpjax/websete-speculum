using Wolverine;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWolverine();

var app = builder.Build();

app.Run();
