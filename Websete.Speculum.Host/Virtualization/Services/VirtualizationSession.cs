using System.Threading.Channels;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Wraps a <see cref="SidecarSession"/> and implements <see cref="IVirtualizationSession"/>.
/// </summary>
internal sealed class VirtualizationSession : IVirtualizationSession
{
    private readonly SidecarSession _sidecar;

    public string SessionId => _sidecar.SessionId;
    public int    Width     => _sidecar.Width;
    public int    Height    => _sidecar.Height;

    public ChannelReader<ReadOnlyMemory<byte>> FrameChannel => _sidecar.FrameChannel;

    internal VirtualizationSession(SidecarSession sidecar)
        => _sidecar = sidecar;

    public Task NavigateAsync(string url)               => _sidecar.NavigateAsync(url);
    public Task RefreshAsync()                          => _sidecar.RefreshAsync();
    public Task ResizeAsync(int width, int height)      => _sidecar.ResizeAsync(width, height);
    public Task DispatchInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default) => _sidecar.DispatchInputAsync(raw, ct);

    public ValueTask DisposeAsync()                     => _sidecar.DisposeAsync();
}
