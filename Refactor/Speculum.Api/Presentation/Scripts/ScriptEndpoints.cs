using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Scripts.Requests;
using Speculum.Api.Scripts.Services.Contracts;

namespace Speculum.Api.Presentation.Scripts;

public static class ScriptEndpoints
{
    public static IEndpointRouteBuilder MapScriptEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/scripts", async (
            string? query,
            int? skip,
            int? take,
            IScriptService scripts,
            CancellationToken ct) =>
        {
            var result = await scripts.ListScriptsAsync(
                new ListScripts
                {
                    Query = query ?? string.Empty,
                    Skip = skip ?? 0,
                    Take = take ?? ListScripts.DefaultTake,
                },
                ct).ConfigureAwait(false);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault() ?? "Script listing failed" });
        }).WithTags("Scripts");

        endpoints.MapPost("/api/scripts", async (
            HttpRequest request,
            IScriptService scripts,
            CancellationToken ct) =>
        {
            if (!request.HasFormContentType)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["body"] = ["Multipart form body is required."],
                });
            }

            var form = await request.ReadFormAsync(ct).ConfigureAwait(false);
            var file = form.Files["file"];
            if (file is null || file.Length <= 0)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = ["Script file is required."],
                });
            }

            await using var stream = file.OpenReadStream();
            if (file.Length > Speculum.Api.Scripts.Services.ScriptService.MaxScriptBytes)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = [$"Script file exceeds {Speculum.Api.Scripts.Services.ScriptService.MaxScriptBytes} bytes."],
                });
            }

            using var reader = new StreamReader(stream);
            var content = await reader.ReadToEndAsync(ct).ConfigureAwait(false);
            if (Encoding.UTF8.GetByteCount(content) > Speculum.Api.Scripts.Services.ScriptService.MaxScriptBytes)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = [$"Script file exceeds {Speculum.Api.Scripts.Services.ScriptService.MaxScriptBytes} bytes."],
                });
            }
            var name = (form["name"].FirstOrDefault() ?? file.FileName ?? string.Empty).Trim();

            var result = await scripts.CreateStoredScriptAsync(
                new CreateStoredScript
                {
                    Name = name,
                    Content = content,
                },
                ct).ConfigureAwait(false);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault() ?? "Script upload failed" });
        }).WithTags("Scripts");

        endpoints.MapDelete("/api/scripts/{scriptId:guid}", async (
            Guid scriptId,
            IScriptService scripts,
            CancellationToken ct) =>
        {
            var result = await scripts.DeleteScriptAsync(
                new DeleteScript { ScriptId = scriptId },
                ct).ConfigureAwait(false);

            return result.IsSuccess
                ? Results.Ok(new { ok = true, scriptId })
                : Results.NotFound(new { error = result.Errors.FirstOrDefault() ?? "Script not found" });
        }).WithTags("Scripts");

        return endpoints;
    }
}
