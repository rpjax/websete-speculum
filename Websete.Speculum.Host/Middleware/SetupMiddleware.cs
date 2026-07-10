using Websete.Speculum.Host.Config.Store;

namespace Websete.Speculum.Host.Middleware;

public sealed class SetupMiddleware
{
    private static readonly string[] PassThroughPrefixes =
    [
        "/health",
        "/ready",
        "/setup",
        "/api/admin",
        "/libs/",
        "/openapi",
    ];

    private readonly RequestDelegate _next;

    public SetupMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ISpeculumConfigStore store)
    {
        var path = context.Request.Path.Value ?? "";

        if (IsPassThrough(path))
        {
            await _next(context);
            return;
        }

        if (!store.IsOperational)
        {
            if (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Redirect("/setup");
                return;
            }

            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new
            {
                error   = "Motor not configured.",
                missing = store.MissingRequired,
                setup   = "/setup",
            });
            return;
        }

        await _next(context);
    }

    private static bool IsPassThrough(string path)
    {
        foreach (var prefix in PassThroughPrefixes)
        {
            if (prefix.EndsWith('/'))
            {
                if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            else if (path.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                     || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
