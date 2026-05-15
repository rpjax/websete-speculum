using System.Security.Cryptography.X509Certificates;

namespace Websete.Speculum.Host.Certs;

/// <summary>
/// Provides pre-loaded TLS certificates for Kestrel's SNI selector.
///
/// Implementations load every certificate during application startup and
/// fail fast if any forwarding profile is missing its certificate files.
/// </summary>
public interface ICertificateProvider
{
    /// <summary>
    /// Returns the certificate whose domain matches <paramref name="serverName"/>
    /// (exact or subdomain match). Falls back to the default certificate when
    /// no exact match is found.
    /// </summary>
    /// <param name="serverName">
    /// SNI server name from the TLS ClientHello (e.g. <c>www.websete.localhost</c>).
    /// </param>
    X509Certificate2 GetCertificate(string serverName);

    /// <summary>
    /// Returns the first loaded certificate. Used when the client sends no SNI.
    /// </summary>
    X509Certificate2 GetDefaultCertificate();
}
