using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Ephemeral ECDSA P-256 certificate for Kestrel WebTransport (HTTP/3).
/// The default ASP.NET development certificate is not accepted by Chromium's
/// WebTransport stack; callers pin <see cref="Sha256Base64"/> via
/// <c>serverCertificateHashes</c>.
/// </summary>
public sealed class WebTransportDevCertificate
{
    public X509Certificate2 Certificate { get; }

    /// <summary>SHA-256 of the certificate DER, base64 — browser pin value.</summary>
    public string Sha256Base64 { get; }

    private WebTransportDevCertificate(X509Certificate2 certificate, string sha256Base64)
    {
        Certificate = certificate;
        Sha256Base64 = sha256Base64;
    }

    public static WebTransportDevCertificate Create(TimeProvider? time = null)
    {
        var clock = time ?? TimeProvider.System;
        var now = clock.GetUtcNow();
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(System.Net.IPAddress.Loopback);
        san.AddIpAddress(System.Net.IPAddress.IPv6Loopback);

        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=localhost", ecdsa, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(
            new X509EnhancedKeyUsageExtension(
                new OidCollection { new("1.3.6.1.5.5.7.3.1") },
                critical: false));
        request.CertificateExtensions.Add(
            new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, critical: false));
        request.CertificateExtensions.Add(san.Build());

        // Chromium caps WebTransport hash-pinned cert lifetime at 14 days.
        using var created = request.CreateSelfSigned(now, now.AddDays(14));
        var exportable = X509CertificateLoader.LoadPkcs12(
            created.Export(X509ContentType.Pfx),
            password: null,
            X509KeyStorageFlags.Exportable);

        var hash = SHA256.HashData(exportable.RawData);
        return new WebTransportDevCertificate(exportable, Convert.ToBase64String(hash));
    }
}
