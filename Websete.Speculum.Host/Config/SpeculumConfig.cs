using System.Collections.Immutable;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;

namespace Websete.Speculum.Host.Config;

#region Binding model (somente para ConfigurationBinder — não exponha referências)

internal sealed class SpeculumConfigBindingModel
{
    public string Environment { get; set; } = string.Empty;
    public string HttpAddress { get; set; } = string.Empty;
    public int MaxSessions { get; set; }
    public ForwardingProfileBinding[]  ForwardingProfiles { get; set; } = Array.Empty<ForwardingProfileBinding>();
    public ScriptInjectionBinding[]    ScriptInjection    { get; set; } = Array.Empty<ScriptInjectionBinding>();
    public JsBridgeBinding             JsBridge           { get; set; } = new();
}

internal sealed class ScriptInjectionBinding
{
    public string Position { get; set; } = "HeaderTop";
    public string File     { get; set; } = string.Empty;
    public string Type     { get; set; } = "Classic";
}

internal sealed class JsBridgeBinding
{
    public bool Enable { get; set; } = false;
}

internal sealed class ForwardingProfileBinding
{
    public string Upstream   { get; set; } = string.Empty;
    public string Downstream { get; set; } = string.Empty;
}

#endregion

/// <summary>
/// Immutable snapshot of the JsBridge configuration.
/// </summary>
public sealed class JsBridgeOptions
{
    /// <summary>
    /// When <c>true</c>, the sidecar forwards virtual browser console output
    /// to the downstream client and exposes <c>window.vcon(code)</c>.
    /// </summary>
    public bool Enable { get; }

    internal JsBridgeOptions(bool enable) => Enable = enable;
}

/// <summary>
/// Immutable representation of a single script injection entry.
/// <see cref="ScriptInjectionService"/> resolves the file content at startup.
/// </summary>
public sealed class ScriptInjectionEntry
{
    public string Position { get; }
    public string File     { get; }
    public string Type     { get; }

    internal ScriptInjectionEntry(string position, string file, string type)
    {
        Position = position;
        File     = file;
        Type     = type;
    }
}

/// <summary>
/// Immutable forwarding profile: maps one downstream domain (the Speculum-owned
/// domain, e.g. <c>websete.localhost</c>) to one upstream real site
/// (e.g. <c>olx.com.br</c>).
///
/// Multiple profiles enable multiple domains pointing to the same host, each
/// routing to a different upstream.  The uniqueness constraint enforced at
/// startup guarantees that no two downstreams are in a parent/subdomain
/// relationship, so host matching is always unambiguous.
/// </summary>
public sealed class ForwardingProfile
{
    /// <summary>The real target site (e.g. <c>olx.com.br</c>).</summary>
    public string Upstream   { get; }

    /// <summary>
    /// The Speculum-owned domain clients connect to (e.g. <c>websete.localhost</c>).
    /// Subdomains are matched automatically; the uniqueness constraint prevents
    /// ambiguity when multiple profiles are configured.
    /// </summary>
    public string Downstream { get; }

    internal ForwardingProfile(string upstream, string downstream)
    {
        Upstream   = upstream;
        Downstream = downstream;
    }

    /// <summary>
    /// Returns <see langword="true"/> when <paramref name="host"/> equals
    /// <see cref="Downstream"/> or is a direct subdomain of it
    /// (e.g. <c>www.websete.localhost</c> matches <c>websete.localhost</c>).
    ///
    /// Subdomain matching is safe because the startup validator guarantees no
    /// two downstreams are in a parent/child relationship.
    /// </summary>
    public bool MatchesHost(string host)
    {
        if (string.IsNullOrEmpty(host)) return false;
        return host.Equals(Downstream, StringComparison.OrdinalIgnoreCase) ||
               host.EndsWith('.' + Downstream, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// Snapshot imutável da configuração. Obtido apenas via <see cref="Load"/>.
/// </summary>
public sealed class SpeculumConfig
{
    public string Environment { get; }
    public string HttpAddress { get; }
    public int MaxSessions { get; }
    public ImmutableArray<ForwardingProfile>    ForwardingProfiles { get; }
    public ImmutableArray<ScriptInjectionEntry> ScriptInjection    { get; }
    public JsBridgeOptions                      JsBridge           { get; }

    private SpeculumConfig(
        string environment,
        string httpAddress,
        int maxSessions,
        ImmutableArray<ForwardingProfile>    forwardingProfiles,
        ImmutableArray<ScriptInjectionEntry> scriptInjection,
        JsBridgeOptions                      jsBridge)
    {
        Environment        = environment;
        HttpAddress        = httpAddress;
        MaxSessions        = maxSessions;
        ForwardingProfiles = forwardingProfiles;
        ScriptInjection    = scriptInjection;
        JsBridge           = jsBridge;
    }

    /// <summary>
    /// Lê as chaves na raiz do <see cref="IConfiguration"/> (appsettings + ambiente + env vars),
    /// igual ao fluxo montado por <c>WebApplication.CreateBuilder(args)</c> em <c>Program.cs</c>.
    /// Retorna um snapshot imutável (coleções e texto não são mutáveis pelo consumidor).
    /// </summary>
    /// <param name="configuration">The merged configuration (appsettings + environment).</param>
    /// <param name="webRootPath">
    ///   Absolute path to <c>wwwroot</c>. When supplied, every <c>ScriptInjection[*].File</c>
    ///   entry is resolved against this root and validated to exist on disk.
    ///   Pass <see langword="null"/> only in unit tests that do not touch the file system.
    /// </param>
    public static SpeculumConfig Load(IConfiguration configuration, string? webRootPath = null)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var binding = new SpeculumConfigBindingModel();
        configuration.Bind(binding);
        SpeculumConfigValidator.Validate(binding, webRootPath);
        return Freeze(binding);
    }

    private static SpeculumConfig Freeze(SpeculumConfigBindingModel m)
    {
        var rawProfiles = m.ForwardingProfiles ?? Array.Empty<ForwardingProfileBinding>();
        var profiles = ImmutableArray.CreateBuilder<ForwardingProfile>(rawProfiles.Length);

        foreach (var pb in rawProfiles)
            profiles.Add(new ForwardingProfile(pb.Upstream.Trim(), pb.Downstream.Trim()));

        var rawScripts = m.ScriptInjection ?? Array.Empty<ScriptInjectionBinding>();
        var scripts    = ImmutableArray.CreateBuilder<ScriptInjectionEntry>(rawScripts.Length);

        foreach (var sb in rawScripts)
            scripts.Add(new ScriptInjectionEntry(sb.Position, sb.File, sb.Type));

        var jsBridge = new JsBridgeOptions(m.JsBridge?.Enable ?? false);

        return new SpeculumConfig(
            m.Environment,
            m.HttpAddress,
            m.MaxSessions,
            profiles.MoveToImmutable(),
            scripts.MoveToImmutable(),
            jsBridge);
    }
}

internal static class SpeculumConfigValidator
{
    private static readonly Regex FqdnRegex = new(
        @"^(?i)[a-z0-9]+([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]+([-a-z0-9]*[a-z0-9])?)+$",
        RegexOptions.Compiled,
        TimeSpan.FromMilliseconds(250));

    private static ReadOnlySpan<char> UrlAndPathChars => " /:\\";

    private static ReadOnlySpan<char> PathSeparatorsAndSlashes => "/\\";

    internal static void Validate(SpeculumConfigBindingModel config, string? webRootPath = null)
    {
        ArgumentNullException.ThrowIfNull(config);

        var b = new ValidationResultBuilder();

        ValidateEnvironment(config.Environment, b);
        ValidateHttpAddress(config.HttpAddress, b);
        ValidateMaxSessions(config.MaxSessions, b);
        ValidateForwardingProfiles(config.ForwardingProfiles, b);
        ValidateScriptInjection(config.ScriptInjection, b, webRootPath);

        b.ThrowIfInvalid();
    }

    private static void ValidateEnvironment(string environment, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(environment))
        {
            b.WithError("$.Environment", "Environment is empty");
            return;
        }

        var e = environment.Trim();
        if (e.Length > 64)
            b.WithError("$.Environment", "Exceeds 64 characters");

        if (ContainsAnyChar(e.AsSpan(), PathSeparatorsAndSlashes))
            b.WithError("$.Environment", "Must not contain path characters");
    }

    private static void ValidateHttpAddress(string addr, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(addr))
        {
            b.WithError("$.HttpAddress", "Address is empty");
            return;
        }

        if (!TrySplitHostPort(addr.Trim(), out _, out _, out var detail))
        {
            b.WithError("$.HttpAddress", string.IsNullOrEmpty(detail) ? "Invalid host:port format" : detail);
            return;
        }
    }

    private static void ValidateMaxSessions(int max, ValidationResultBuilder b)
    {
        if (max <= 0)
            b.WithError("$.MaxSessions", "Must be greater than 0");

        if (max > 65535)
            b.WithError("$.MaxSessions", "Exceeds safe OS-oriented upper bound (65535)");
    }

    private static void ValidateForwardingProfiles(ForwardingProfileBinding[] profiles, ValidationResultBuilder b)
    {
        if (profiles.Length == 0)
        {
            b.WithError("$.ForwardingProfiles", "At least one forwarding profile is required");
            return;
        }

        for (var i = 0; i < profiles.Length; i++)
        {
            var prefix  = $"$.ForwardingProfiles[{i}]";
            var profile = profiles[i];

            if (profile is null) { b.WithError(prefix, "Entry is null"); continue; }

            ValidateFqdn(profile.Upstream,   prefix + ".Upstream",   b);
            ValidateFqdn(profile.Downstream, prefix + ".Downstream", b);
        }

        // ── Downstream uniqueness and non-containment ─────────────────────────
        // Two profiles conflict when one downstream is a subdomain of the other.
        // Example: "websete.localhost" and "api.websete.localhost" conflict because
        // the second would be matched by the first's subdomain rule, making routing
        // ambiguous.  Exact duplicates are also rejected.
        for (var i = 0; i < profiles.Length; i++)
        {
            var a = profiles[i]?.Downstream?.Trim() ?? "";
            if (!IsValidFqdn(a)) continue;

            for (var j = i + 1; j < profiles.Length; j++)
            {
                var b2 = profiles[j]?.Downstream?.Trim() ?? "";
                if (!IsValidFqdn(b2)) continue;

                if (a.Equals(b2, StringComparison.OrdinalIgnoreCase))
                {
                    b.WithError($"$.ForwardingProfiles[{j}].Downstream",
                        $"Duplicate downstream '{b2}' — each downstream must be unique");
                }
                else if (b2.EndsWith('.' + a, StringComparison.OrdinalIgnoreCase))
                {
                    b.WithError($"$.ForwardingProfiles[{j}].Downstream",
                        $"'{b2}' is a subdomain of '{a}' — downstreams cannot contain one another");
                }
                else if (a.EndsWith('.' + b2, StringComparison.OrdinalIgnoreCase))
                {
                    b.WithError($"$.ForwardingProfiles[{i}].Downstream",
                        $"'{a}' is a subdomain of '{b2}' — downstreams cannot contain one another");
                }
            }
        }
    }

    /// <summary>Validates that <paramref name="value"/> is a bare FQDN (no scheme, path or spaces).</summary>
    private static void ValidateFqdn(string value, string jsonPath, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            b.WithError(jsonPath, "Cannot be empty");
            return;
        }

        var v = value.Trim();

        if (ContainsAnyChar(v.AsSpan(), UrlAndPathChars))
        {
            b.WithError(jsonPath, "Must be a bare FQDN — no scheme, spaces or path (e.g. 'example.com')");
            return;
        }

        if (!IsValidFqdn(v))
            b.WithError(jsonPath, "Not a valid FQDN");
    }

    private static readonly HashSet<string> ValidPositions =
        new(["HeaderTop", "HeaderBottom", "BodyTop", "BodyBottom"], StringComparer.Ordinal);

    private static readonly HashSet<string> ValidTypes =
        new(["Classic", "Module"], StringComparer.Ordinal);

    private const int MaxScriptFileSizeBytes = 5 * 1024 * 1024; // 5 MB

    private static void ValidateScriptInjection(
        ScriptInjectionBinding[]? entries,
        ValidationResultBuilder   b,
        string?                   webRootPath)
    {
        if (entries is null or { Length: 0 }) return; // ScriptInjection is optional

        for (var i = 0; i < entries.Length; i++)
        {
            var prefix = $"$.ScriptInjection[{i}]";
            var entry  = entries[i];

            if (entry is null) { b.WithError(prefix, "Entry is null"); continue; }

            // Position
            if (string.IsNullOrWhiteSpace(entry.Position))
                b.WithError(prefix + ".Position", "Position is empty");
            else if (!ValidPositions.Contains(entry.Position))
                b.WithError(prefix + ".Position",
                    $"Invalid value '{entry.Position}'. Valid values: {string.Join(", ", ValidPositions)}");

            // Type
            if (string.IsNullOrWhiteSpace(entry.Type))
                b.WithError(prefix + ".Type", "Type is empty");
            else if (!ValidTypes.Contains(entry.Type))
                b.WithError(prefix + ".Type",
                    $"Invalid value '{entry.Type}'. Valid values: {string.Join(", ", ValidTypes)}");

            // File — format first, then disk existence
            if (string.IsNullOrWhiteSpace(entry.File))
            {
                b.WithError(prefix + ".File", "File is empty");
            }
            else
            {
                var f          = entry.File.Trim();
                var formatOk   = true;

                if (!f.StartsWith('/'))
                {
                    b.WithError(prefix + ".File", "File must be a root-relative path starting with '/'");
                    formatOk = false;
                }

                if (f.Contains("..") || f.Contains('\\'))
                {
                    b.WithError(prefix + ".File", "File must not contain '..' or backslashes");
                    formatOk = false;
                }

                if (!f.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
                {
                    b.WithError(prefix + ".File", "File must have a .js extension");
                    formatOk = false;
                }

                // Disk existence — only checked when the path format is valid and
                // webRootPath is known (null only in tests).
                if (formatOk && webRootPath != null)
                {
                    var physical = Path.Combine(
                        webRootPath,
                        f.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

                    if (!File.Exists(physical))
                        b.WithError(prefix + ".File",
                            $"File not found: '{f}' (resolved to '{physical}')");
                }
            }
        }
    }

    private static bool IsValidFqdn(string domain)
    {
        if (string.IsNullOrWhiteSpace(domain))
            return false;

        var d = domain.Trim();
        if (ContainsAnyChar(d.AsSpan(), UrlAndPathChars))
            return false;

        try
        {
            return FqdnRegex.IsMatch(d);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }

    private static bool ContainsAnyChar(ReadOnlySpan<char> span, ReadOnlySpan<char> anyOf)
    {
        foreach (var c in span)
        {
            if (anyOf.Contains(c))
                return true;
        }

        return false;
    }

    /// <summary>Análogo a net.SplitHostPort + faixa de porta TCP.</summary>
    private static bool TrySplitHostPort(string address, out string host, out int port, out string? detail)
    {
        host = string.Empty;
        port = 0;
        detail = null;

        if (IPEndPoint.TryParse(address, out var ep))
        {
            host = ep.Address.ToString();
            port = ep.Port;
            return port is >= 1 and <= 65535;
        }

        if (address.StartsWith('['))
        {
            var end = address.IndexOf(']', 1);
            if (end < 0)
            {
                detail = "Malformed IPv6 bracket";
                return false;
            }

            host = address[1..end];
            if (end + 1 >= address.Length || address[end + 1] != ':')
            {
                detail = "Expected ':port' after IPv6 address";
                return false;
            }

            if (!int.TryParse(address.AsSpan(end + 2), NumberStyles.None, CultureInfo.InvariantCulture, out port))
            {
                detail = "Invalid port";
                return false;
            }

            if (port is < 1 or > 65535)
            {
                detail = $"Port invalid: {port}";
                return false;
            }

            return true;
        }

        var lastColon = address.LastIndexOf(':');
        if (lastColon <= 0 || lastColon == address.Length - 1)
        {
            detail = address.Contains(':')
                ? "Invalid format (use [IPv6]:port for IPv6)"
                : "Expected host:port";
            return false;
        }

        host = address[..lastColon];
        if (host.Contains(':') && !IPAddress.TryParse(host, out _))
        {
            detail = "Invalid format (IPv6 must use [addr]:port)";
            return false;
        }

        if (!int.TryParse(address.AsSpan(lastColon + 1), NumberStyles.None, CultureInfo.InvariantCulture, out port))
        {
            detail = "Invalid port";
            return false;
        }

        if (string.IsNullOrWhiteSpace(host))
        {
            detail = "Host part cannot be empty";
            return false;
        }

        if (port is < 1 or > 65535)
        {
            detail = $"Port invalid: {port}";
            return false;
        }

        return true;
    }

    private sealed class ValidationResultBuilder
    {
        private readonly List<(string Path, string Message)> _errors = new();

        public ValidationResultBuilder WithError(string path, string message)
        {
            _errors.Add((path, message));
            return this;
        }

        public void ThrowIfInvalid()
        {
            if (_errors.Count == 0)
                return;

            var sb = new StringBuilder();
            sb.AppendLine("Speculum configuration validation failed:");
            foreach (var (path, message) in _errors)
                sb.Append("  ").Append(path).Append(": ").AppendLine(message);

            throw new InvalidOperationException(sb.ToString().TrimEnd());
        }
    }
}
