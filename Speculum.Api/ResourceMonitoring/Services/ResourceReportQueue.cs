using System.Threading.Channels;
using Speculum.Api.ResourceMonitoring.Services.Contracts;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class ResourceReportQueue : IResourceReportQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    public ValueTask EnqueueAsync(Guid reportId, CancellationToken ct = default)
        => _channel.Writer.WriteAsync(reportId, ct);

    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct)
        => _channel.Reader.ReadAllAsync(ct);
}
