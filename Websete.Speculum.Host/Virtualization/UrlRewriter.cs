using System.Buffers.Binary;
using System.Text;
using Websete.Speculum.Host.Config;

namespace Websete.Speculum.Host.Virtualization;

/// <summary>
/// Applies bidirectional host-based URL rewriting for a single
/// <see cref="ForwardingProfile"/>.
///
/// Direction conventions:
///   • <b>Upstream</b>   — the real target site (e.g. <c>olx.com.br</c>).
///   • <b>Downstream</b> — the local Speculum domain the user sees
///     (e.g. <c>websete.localhost</c>).
///
/// <see cref="UpstreamToDownstream"/> — rewrites URLs coming from the
///   sidecar (virtual browser navigated to upstream) so the client URL bar
///   shows the downstream domain.
///
/// <see cref="DownstreamToUpstream"/> — rewrites URLs sent by the client
///   (typed in the URL bar) so the virtual browser navigates to the real
///   upstream site.
///
/// When no profile is active (<see cref="Passthrough"/>), all methods
/// return the input unchanged — no allocation, no overhead.
/// </summary>
public sealed class UrlRewriter
{
    private readonly string? _upstream;
    private readonly string? _downstream;

    /// <summary>
    /// A no-op rewriter used when no forwarding profile is active.
    /// All methods return the input unchanged.
    /// </summary>
    public static readonly UrlRewriter Passthrough = new(null);

    public UrlRewriter(ForwardingProfile? profile)
    {
        _upstream   = profile?.Upstream;
        _downstream = profile?.Downstream;
    }

    /// <summary>
    /// The upstream domain for the active profile (e.g. <c>olx.com.br</c>),
    /// or <see langword="null"/> when no profile is active.
    /// Used by <see cref="VSession"/> to tell the sidecar which domain to guard.
    /// </summary>
    public string? UpstreamDomain => _upstream;

    // ── URL string rewriting ──────────────────────────────────────────────────

    /// <summary>
    /// Rewrites the upstream host to the downstream host in
    /// <paramref name="url"/>.  Returns the original string if no rule
    /// matches or the URL is not absolute.
    /// </summary>
    public string UpstreamToDownstream(string url)
        => Rewrite(url, from: _upstream, to: _downstream);

    /// <summary>
    /// Rewrites the downstream host to the upstream host in
    /// <paramref name="url"/>.  Returns the original string if no rule
    /// matches or the URL is not absolute.
    /// </summary>
    public string DownstreamToUpstream(string url)
        => Rewrite(url, from: _downstream, to: _upstream);

    // ── Binary frame rewriting (MSG_URL 0x04) ─────────────────────────────────

    /// <summary>
    /// Rewrites the URL embedded in a raw MSG_URL (0x04) binary frame,
    /// applying <see cref="UpstreamToDownstream"/> on the decoded URL.
    ///
    /// Frame layout (matches Protocol.ts <c>encodeUrlUpdate</c>):
    ///   [0]     type  = 0x04           (1 byte)
    ///   [1..4]  len                    (4 bytes LE uint32)
    ///   [5..]   url                    (len bytes UTF-8)
    ///
    /// Returns the original memory unchanged when no rewriting is needed
    /// (avoids allocation on the hot path).
    /// </summary>
    public ReadOnlyMemory<byte> RewriteUrlFrame(ReadOnlyMemory<byte> raw)
    {
        if (_upstream is null || raw.Length < 5) return raw;

        var len = (int)BinaryPrimitives.ReadUInt32LittleEndian(raw.Span.Slice(1, 4));
        if (5 + len > raw.Length) return raw; // malformed — pass through

        var url       = Encoding.UTF8.GetString(raw.Span.Slice(5, len));
        var rewritten = UpstreamToDownstream(url);
        if (rewritten == url) return raw; // no change — avoid allocation

        var urlBytes = Encoding.UTF8.GetBytes(rewritten);
        var buf      = new byte[5 + urlBytes.Length];
        buf[0] = 0x04;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), (uint)urlBytes.Length);
        urlBytes.CopyTo(buf, 5);
        return buf.AsMemory();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static string Rewrite(string url, string? from, string? to)
    {
        if (string.IsNullOrEmpty(url) || from is null || to is null) return url;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))      return url;
        if (!uri.Host.Equals(from, StringComparison.OrdinalIgnoreCase)) return url;

        var builder = new UriBuilder(uri) { Host = to };
        // Omit the port when the original URI used the scheme's default
        // so the rewritten URL looks clean (no :443 / :80 suffix).
        if (uri.IsDefaultPort) builder.Port = -1;
        return builder.Uri.AbsoluteUri;
    }
}
