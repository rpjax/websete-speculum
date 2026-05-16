using System.Collections.Immutable;
using Websete.Speculum.Host.Config;

namespace Websete.Speculum.Host.ScriptInjection;

/// <summary>
/// Resolves script injection entries from <see cref="SpeculumConfig.ScriptInjection"/>
/// at application startup by reading the declared files from wwwroot.
///
/// Startup semantics:
///   • A missing file throws <see cref="FileNotFoundException"/> — no silent fallback.
///   • Files exceeding <see cref="MaxFileSizeBytes"/> throw <see cref="InvalidOperationException"/>.
///   • Paths are validated by <see cref="Config.SpeculumConfigValidator"/> before this
///     service is constructed (no path-traversal risk at runtime).
///
/// All resolved content is cached in memory for the lifetime of the process.
/// The service is registered as a singleton and is safe to use concurrently after
/// construction (the <see cref="Scripts"/> list is immutable).
/// </summary>
public sealed class ScriptInjectionService
{
    /// <summary>5 MB per-file safety cap (enforced here, also validated in config).</summary>
    private const long MaxFileSizeBytes = 5 * 1024 * 1024;

    /// <summary>
    /// Resolved scripts in declaration order (Position sort is the sidecar's responsibility).
    /// Each entry carries the literal JavaScript content of the file.
    /// </summary>
    public IReadOnlyList<ResolvedScript> Scripts { get; }

    public ScriptInjectionService(SpeculumConfig config, IWebHostEnvironment env)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(env);

        if (config.ScriptInjection.IsDefaultOrEmpty)
        {
            Scripts = ImmutableArray<ResolvedScript>.Empty;
            return;
        }

        var webRoot = env.WebRootPath
            ?? throw new InvalidOperationException(
                "IWebHostEnvironment.WebRootPath is null. " +
                "Ensure UseStaticFiles / wwwroot is configured.");

        var results = new List<ResolvedScript>(config.ScriptInjection.Length);

        foreach (var entry in config.ScriptInjection)
        {
            // Strip the leading '/' so Path.Combine joins correctly on both OS.
            var relativePath = entry.File.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var fullPath     = Path.GetFullPath(Path.Combine(webRoot, relativePath));

            // Defense-in-depth: ensure the resolved path is still inside wwwroot.
            // The config validator already rejects ".." and backslashes, but we
            // verify here as well in case the resolved canonical path escapes via
            // symlinks or other OS-level tricks.
            if (!fullPath.StartsWith(webRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Script injection file '{entry.File}' resolves outside wwwroot. " +
                    "Path traversal is not allowed.");

            if (!File.Exists(fullPath))
                throw new FileNotFoundException(
                    $"Script injection file not found: '{entry.File}' " +
                    $"(resolved to '{fullPath}'). " +
                    "Ensure the file exists in wwwroot before starting the application.",
                    fullPath);

            var info = new FileInfo(fullPath);
            if (info.Length > MaxFileSizeBytes)
                throw new InvalidOperationException(
                    $"Script injection file '{entry.File}' exceeds the {MaxFileSizeBytes / 1024 / 1024} MB limit " +
                    $"(actual size: {info.Length / 1024} KB).");

            var content = File.ReadAllText(fullPath);

            results.Add(new ResolvedScript(
                position: entry.Position,
                type:     entry.Type,
                file:     entry.File,
                content:  content));
        }

        Scripts = results.AsReadOnly();
    }
}

/// <summary>
/// A script injection entry with its file content already loaded from disk.
/// </summary>
public sealed class ResolvedScript
{
    /// <summary>
    /// Injection position declared in config.
    /// One of: <c>HeaderTop</c>, <c>HeaderBottom</c>, <c>BodyTop</c>, <c>BodyBottom</c>.
    /// </summary>
    public string Position { get; }

    /// <summary>
    /// Script type declared in config.
    /// One of: <c>Classic</c>, <c>Module</c>.
    /// </summary>
    public string Type    { get; }

    /// <summary>The wwwroot-relative URL path (e.g. <c>/libs/qrcode.js</c>).</summary>
    public string File    { get; }

    /// <summary>The literal JavaScript source read from disk at startup.</summary>
    public string Content { get; }

    internal ResolvedScript(string position, string type, string file, string content)
    {
        Position = position;
        Type     = type;
        File     = file;
        Content  = content;
    }
}
