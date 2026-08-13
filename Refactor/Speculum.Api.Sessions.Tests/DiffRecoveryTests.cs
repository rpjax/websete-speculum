using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class DiffRecoveryTests
{
    [Fact]
    public void ClientVisibleQueueDroppedStages_CoverChronologyBreakersOnly()
    {
        Assert.True(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("api_fanout_backpressure"));
        Assert.True(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("api_sequenced"));
        Assert.True(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("api_wire_stall"));
        Assert.True(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("api_fanout_pipe_closed"));
        Assert.False(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("api_fanout_no_target"));
        Assert.False(GrpcSessionConnection.IsClientVisibleQueueDroppedStage("sidecar_bridge"));
    }

    [Fact]
    public void ReplacePageProjectionDiffs_ReopensWritableChannelAfterComplete()
    {
        var stream = NewDiffStream();
        Assert.True(stream.PageProjectionDiffs.Writer.TryWrite(Diff(1)));
        stream.PageProjectionDiffs.Writer.TryComplete();
        Assert.True(stream.PageProjectionDiffs.Reader.TryRead(out _));
        Assert.True(stream.PageProjectionDiffs.Reader.Completion.IsCompleted);

        var epochBefore = stream.DiffEpoch;
        var reader = stream.ReplacePageProjectionDiffs();
        Assert.True(stream.DiffEpoch > epochBefore);
        Assert.False(reader.Completion.IsCompleted);
        Assert.True(stream.PageProjectionDiffs.Writer.TryWrite(Diff(2)));
        Assert.True(reader.TryRead(out var item));
        Assert.Equal(2, item.Sequence);
    }

    [Fact]
    public async Task FanOut_PipeClosed_ReportsQueueDroppedAndReopensDiff()
    {
        var connectionDiffs = Channel.CreateUnbounded<PageProjectionDiff>();
        var reports = new ConcurrentQueue<FanOutDropReport>();
        var connection = new FanOutTestConnection(connectionDiffs, reports);
        var streams = new ConcurrentDictionary<Guid, OutputStreamRegistration>();
        var streamId = Guid.NewGuid();
        var stream = NewDiffStream(streamId);
        Assert.True(streams.TryAdd(streamId, stream));

        using var lifetime = new CancellationTokenSource();
        var fanOut = new SessionOutputFanOut(
            connection,
            streams,
            new OutputMultiplexingPolicy(),
            MirrorMode.PageProjection,
            lifetime.Token);
        fanOut.OnStreamRegistered(streamId);
        // Pump starts from OnStreamRegistered (Diff kind).

        // Simulate hub Diff pump ending: complete the fan-out target writer.
        stream.PageProjectionDiffs.Writer.TryComplete();

        await connectionDiffs.Writer.WriteAsync(Diff(10));

        await WaitUntilAsync(
            () => reports.Any(s => s.Stage == "api_fanout_pipe_closed"),
            TimeSpan.FromSeconds(5));

        await WaitUntilAsync(
            () => !stream.PageProjectionDiffs.Reader.Completion.IsCompleted,
            TimeSpan.FromSeconds(5));

        await connectionDiffs.Writer.WriteAsync(Diff(11));

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var resumed = await stream.PageProjectionDiffs.Reader.ReadAsync(readCts.Token);
        Assert.Equal(11, resumed.Sequence);

        lifetime.Cancel();
    }

    [Fact]
    public async Task FanOut_UnreadPipeFull_QueueDroppedCarriesBlockingPipeIdentity()
    {
        var connectionDiffs = Channel.CreateUnbounded<PageProjectionDiff>();
        var reports = new ConcurrentQueue<FanOutDropReport>();
        var connection = new FanOutTestConnection(connectionDiffs, reports);
        var streams = new ConcurrentDictionary<Guid, OutputStreamRegistration>();
        var blockingStreamId = Guid.NewGuid();
        var blockingConsumerId = Guid.CreateVersion7();
        var secondStreamId = Guid.NewGuid();
        var blocking = NewDiffStream(blockingStreamId, blockingConsumerId);
        var second = NewDiffStream(secondStreamId);
        Assert.True(streams.TryAdd(blockingStreamId, blocking));
        Assert.True(streams.TryAdd(secondStreamId, second));

        // First stream Diff Wait is full and never drained — Broadcast must block on it.
        for (long seq = 1; seq <= SequencedDiffChannels.FanOutTargetCapacity; seq++)
        {
            Assert.True(blocking.PageProjectionDiffs.Writer.TryWrite(Diff(seq)));
        }

        using var lifetime = new CancellationTokenSource();
        var fanOut = new SessionOutputFanOut(
            connection,
            streams,
            new OutputMultiplexingPolicy(),
            MirrorMode.PageProjection,
            lifetime.Token,
            fanOutWriteBudgetMs: 80);
        fanOut.OnStreamRegistered(blockingStreamId);
        fanOut.OnStreamRegistered(secondStreamId);

        await connectionDiffs.Writer.WriteAsync(Diff(SequencedDiffChannels.FanOutTargetCapacity + 1));

        await WaitUntilAsync(
            () => reports.Any(s => s.Stage == "api_fanout_backpressure"),
            TimeSpan.FromSeconds(5));

        var qd = reports.First(s => s.Stage == "api_fanout_backpressure");
        Assert.Equal(blockingStreamId, qd.StreamId);
        Assert.Equal(blockingConsumerId, qd.ConsumerId);
        Assert.Equal("pageProjectionDiff", qd.Kind);
        Assert.Equal(2, qd.TargetCount);
        Assert.Equal(SequencedDiffChannels.FanOutTargetCapacity, qd.DiffChannelCount);

        lifetime.Cancel();
    }

    [Fact]
    public async Task FanOut_DoesNotDrainDiffs_UntilDiffStreamRegisters()
    {
        var connectionDiffs = Channel.CreateUnbounded<PageProjectionDiff>();
        var reports = new ConcurrentQueue<FanOutDropReport>();
        var connection = new FanOutTestConnection(connectionDiffs, reports);
        var streams = new ConcurrentDictionary<Guid, OutputStreamRegistration>();
        var consumerId = Guid.CreateVersion7();
        var notification = OutputStreamRegistration.CreateNotification(Guid.NewGuid(), consumerId);
        Assert.True(streams.TryAdd(notification.StreamId, notification));

        using var lifetime = new CancellationTokenSource();
        var fanOut = new SessionOutputFanOut(
            connection,
            streams,
            new OutputMultiplexingPolicy(),
            MirrorMode.PageProjection,
            lifetime.Token);
        fanOut.OnStreamRegistered(notification.StreamId);

        await connectionDiffs.Writer.WriteAsync(Diff(7));
        await Task.Delay(80);
        Assert.Empty(reports);
        Assert.True(connectionDiffs.Reader.TryPeek(out var peeked));
        Assert.Equal(7, peeked.Sequence);

        var diff = NewDiffStream(Guid.NewGuid(), consumerId);
        Assert.True(streams.TryAdd(diff.StreamId, diff));
        fanOut.OnStreamRegistered(diff.StreamId);

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var received = await diff.PageProjectionDiffs.Reader.ReadAsync(readCts.Token);
        Assert.Equal(7, received.Sequence);
        Assert.Empty(reports);

        lifetime.Cancel();
    }

    [Fact]
    public async Task FanOut_IgnoresNonDiffStreams_EnqueuesOnlyDiffOnce()
    {
        var connectionDiffs = Channel.CreateUnbounded<PageProjectionDiff>();
        var reports = new ConcurrentQueue<FanOutDropReport>();
        var fanOutReports = new ConcurrentQueue<(Guid StreamId, Guid ConsumerId, string Kind, int TargetCount)>();
        var connection = new FanOutTestConnection(connectionDiffs, reports, fanOutReports);
        var streams = new ConcurrentDictionary<Guid, OutputStreamRegistration>();
        var consumerId = Guid.CreateVersion7();
        var notification = OutputStreamRegistration.CreateNotification(Guid.NewGuid(), consumerId);
        var console = OutputStreamRegistration.CreateConsole(Guid.NewGuid(), consumerId);
        var diff = NewDiffStream(Guid.NewGuid(), consumerId);
        Assert.True(streams.TryAdd(notification.StreamId, notification));
        Assert.True(streams.TryAdd(console.StreamId, console));
        Assert.True(streams.TryAdd(diff.StreamId, diff));

        using var lifetime = new CancellationTokenSource();
        var fanOut = new SessionOutputFanOut(
            connection,
            streams,
            new OutputMultiplexingPolicy(),
            MirrorMode.PageProjection,
            lifetime.Token);
        fanOut.OnStreamRegistered(notification.StreamId);
        fanOut.OnStreamRegistered(console.StreamId);
        fanOut.OnStreamRegistered(diff.StreamId);

        await connectionDiffs.Writer.WriteAsync(Diff(42));

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var received = await diff.PageProjectionDiffs.Reader.ReadAsync(readCts.Token);
        Assert.Equal(42, received.Sequence);

        await WaitUntilAsync(() => fanOutReports.Count >= 1, TimeSpan.FromSeconds(5));
        Assert.Single(fanOutReports);
        var fe = fanOutReports.Single();
        Assert.Equal(diff.StreamId, fe.StreamId);
        Assert.Equal(consumerId, fe.ConsumerId);
        Assert.Equal("pageProjectionDiff", fe.Kind);
        Assert.Equal(1, fe.TargetCount);
        Assert.Empty(reports);

        lifetime.Cancel();
    }

    [Fact]
    public void FanOutTargetCapacity_StaysMuchSmallerThanConnectionDefault()
    {
        Assert.True(SequencedDiffChannels.FanOutTargetCapacity <= 256);
        Assert.True(SequencedDiffChannels.FanOutTargetCapacity < SequencedDiffChannels.DefaultCapacity / 8);
    }

    private sealed record FanOutDropReport(
        string Stage,
        Guid? StreamId,
        Guid? ConsumerId,
        string? Kind,
        int? TargetCount,
        int? DiffChannelCount);

    private static OutputStreamRegistration NewDiffStream(
        Guid? streamId = null,
        Guid? consumerId = null)
        => OutputStreamRegistration.CreatePageProjectionDiff(
            streamId ?? Guid.NewGuid(),
            consumerId ?? Guid.NewGuid());

    private static PageProjectionDiff Diff(long sequence) => new()
    {
        Sequence = sequence,
        Generation = 1,
        Plane = "dom",
        Operation = "childList",
    };

    private static async Task WaitUntilAsync(Func<bool> predicate, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.Fail($"Condition not met within {timeout.TotalSeconds:0}s");
    }

    private sealed class FanOutTestConnection : ISessionConnection
    {
        private readonly Channel<PageProjectionDiff> _diffs;
        private readonly ConcurrentQueue<FanOutDropReport> _reports;
        private readonly ConcurrentQueue<(Guid StreamId, Guid ConsumerId, string Kind, int TargetCount)>? _fanOut;

        public FanOutTestConnection(
            Channel<PageProjectionDiff> diffs,
            ConcurrentQueue<FanOutDropReport> reports,
            ConcurrentQueue<(Guid StreamId, Guid ConsumerId, string Kind, int TargetCount)>? fanOut = null)
        {
            _diffs = diffs;
            _reports = reports;
            _fanOut = fanOut;
        }

        public Guid SessionId { get; } = Guid.NewGuid();
        public bool IsOpen => true;

        public IResult<ChannelReader<PageProjectionDiff>> GetPageProjectionDiffReader()
            => Result<ChannelReader<PageProjectionDiff>>.Success(_diffs.Reader);

        public IResult<ChannelReader<Frame>> GetFrameReader()
            => Result<ChannelReader<Frame>>.Failure("unused");

        public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
            => Result<ChannelReader<ConsoleOutput>>.Success(Channel.CreateUnbounded<ConsoleOutput>().Reader);

        public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
            => Result<ChannelReader<SessionNotification>>.Success(
                Channel.CreateUnbounded<SessionNotification>().Reader);

        public void BindPageProjectionDiffTelemetry(IPageProjectionDiffTelemetry? telemetry) { }

        public bool IsPageProjectionDiffFanOutEnqueuedEnabled() => true;

        public void ReportPageProjectionDiffFanOutEnqueued(
            PageProjectionDiff diff,
            long waitMs,
            Guid streamId,
            Guid consumerId,
            string kind,
            int targetIndex,
            int targetCount,
            int diffChannelCount,
            long diffEpoch)
            => _fanOut?.Enqueue((streamId, consumerId, kind, targetCount));

        public void ReportPageProjectionDiffOutputStreamOpened(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount,
            int diffChannelCapacity) { }

        public void ReportPageProjectionDiffOutputStreamClosed(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount) { }

        public void ReportPageProjectionDiffQueueDropped(
            string stage,
            int droppedCount,
            int capacity,
            long? sequence = null,
            long? generation = null,
            string? plane = null,
            string? operation = null,
            long? lowestDroppedSequence = null,
            long? highestDroppedSequence = null,
            string? reason = null,
            Guid? streamId = null,
            Guid? consumerId = null,
            string? kind = null,
            int? targetCount = null,
            int? diffChannelCount = null,
            long? diffEpoch = null)
            => _reports.Enqueue(new FanOutDropReport(stage, streamId, consumerId, kind, targetCount, diffChannelCount));


        public Task<IResult> CloseAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> StopBrowserAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<CookieNormalizeStats>> RestoreProfileStateAsync(
            ProfileState state,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public IResult<Task> ConsumeVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> channelReader)
            => Result<Task>.Failure("unused");

        public IResult<Task> ConsumePageProjectionIntentAsync(ChannelReader<PageProjectionIntent> channelReader)
            => Result<Task>.Failure("unused");

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Failure("unused");

        public Task<IResult<DomAsset>> GetDomAssetAsync(
            string key,
            CancellationToken ct = default,
            string? kind = null,
            string? rangeHeader = null)
            => throw new NotSupportedException();

        public Task<IResult<PageProjectionResyncSnapshot>> GetPageProjectionResyncAsync(
            long generation,
            long sequence,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> PutDomUploadAsync(
            string uploadId,
            byte[] body,
            string contentType,
            string name,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> ReportPageProjectionClientStateAsync(
            PageProjectionClientStateReport report,
            CancellationToken ct = default)
            => throw new NotSupportedException();
    }
}
