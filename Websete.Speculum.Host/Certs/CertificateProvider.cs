using System.Collections.Immutable;
using System.Security.Cryptography.X509Certificates;
using Websete.Speculum.Host.Config;

namespace Websete.Speculum.Host.Certs;

/// <summary>
/// Loads and caches TLS certificates for all forwarding profiles at startup.
///
/// Expected on-disk layout:
/// <code>
///   {certBasePath}/{domain}/privkey.pem
///   {certBasePath}/{domain}/fullchain.pem
/// </code>
/// where <c>domain</c> is <see cref="ForwardingProfile.Domain"/>.
///
/// Throws <see cref="InvalidOperationException"/> during <see cref="Create"/>
/// if any certificate file is missing — the application must not start
/// without a valid certificate for every configured profile.
///
/// Thread-safe after construction (all state is immutable / read-only).
/// Implements <see cref="IDisposable"/> so certificates are released on
/// application shutdown.
/// </summary>
public sealed class CertificateProvider : ICertificateProvider, IDisposable
{
    const string FullChainFile = "fullchain.pem";
    const string PrivateKeyFile = "privkey.pem";

    private readonly record struct Entry(
        string           Domain,
        bool             AllowSubDomains,
        X509Certificate2 Certificate);

    private readonly ImmutableArray<Entry> _entries;
    private volatile bool                  _disposed;

    private CertificateProvider(ImmutableArray<Entry> entries)
        => _entries = entries;

    // ── Factory ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Loads certificates for every profile in <paramref name="config"/>.
    /// Throws immediately if any <c>privkey.pem</c> or <c>fullchain.pem</c>
    /// is absent.
    /// </summary>
    /// <param name="config">Validated Speculum configuration.</param>
    /// <param name="certBasePath">
    /// Root directory that contains one sub-folder per domain.
    /// Typically <c>/Certificates</c> in Docker or
    /// <c>{ContentRootPath}/Certificates</c> in development.
    /// </param>
    public static CertificateProvider Create(SpeculumConfig config, string certBasePath)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentException.ThrowIfNullOrWhiteSpace(certBasePath);

        var builder = ImmutableArray.CreateBuilder<Entry>(
            config.ForwardingProfiles.Length);

        foreach (var profile in config.ForwardingProfiles)
        {
            var domain       = profile.Domain;
            var dir          = Path.Combine(certBasePath, domain);
            var privkeyPath  = Path.Combine(dir, PrivateKeyFile);
            var fullchainPath = Path.Combine(dir, FullChainFile);

            AssertFileExists(privkeyPath,  profile.Domain, "private key");
            AssertFileExists(fullchainPath, profile.Domain, "full chain");

            // CreateFromPemFile reads fullchain (cert + intermediates) and
            // the separate private key. Works on all .NET 10 platforms.
            var cert = X509Certificate2.CreateFromPemFile(fullchainPath, privkeyPath);

            Console.WriteLine(
                $"[Certs] Loaded certificate for '{domain}': " +
                $"subject={cert.Subject} " +
                $"expires={cert.GetExpirationDateString()}");

            builder.Add(new Entry(domain, profile.AllowSubDomains, cert));
        }

        return new CertificateProvider(builder.MoveToImmutable());
    }

    // ── ICertificateProvider ──────────────────────────────────────────────────

    /// <inheritdoc/>
    public X509Certificate2 GetCertificate(string serverName)
    {
        if (string.IsNullOrEmpty(serverName))
            return GetDefaultCertificate();

        foreach (var entry in _entries)
        {
            // Exact match.
            if (serverName.Equals(entry.Domain, StringComparison.OrdinalIgnoreCase))
                return entry.Certificate;

            // Subdomain match: www.websete.localhost → websete.localhost.
            if (entry.AllowSubDomains &&
                serverName.EndsWith('.' + entry.Domain, StringComparison.OrdinalIgnoreCase))
                return entry.Certificate;
        }

        // No profile-specific certificate — fall back to the first loaded cert.
        return GetDefaultCertificate();
    }

    /// <inheritdoc/>
    public X509Certificate2 GetDefaultCertificate()
    {
        if (_entries.IsEmpty)
            throw new InvalidOperationException("[Certs] No certificates are loaded.");

        return _entries[0].Certificate;
    }

    // ── IDisposable ───────────────────────────────────────────────────────────

    public void Dispose()
    {
        // Volatile write ensures the flag is visible across threads before we
        // begin releasing the certificate objects.
        if (_disposed) return;
        _disposed = true;

        foreach (var entry in _entries)
        {
            try { entry.Certificate.Dispose(); }
            catch { /* best-effort */ }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static void AssertFileExists(string path, string domain, string kind)
    {
        if (!File.Exists(path))
            throw new InvalidOperationException(
                $"[Certs] {char.ToUpperInvariant(kind[0])}{kind[1..]} file not found " +
                $"for profile '{domain}'. " +
                $"Expected: {path}");
    }
}
