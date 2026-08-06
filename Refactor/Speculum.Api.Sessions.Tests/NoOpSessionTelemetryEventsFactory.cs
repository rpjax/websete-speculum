using System.Reflection;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

internal sealed class NoOpSessionTelemetryEventsFactory(
    ISessionClientTelemetryEvents? client = null,
    ISessionNavigateTelemetryEvents? navigate = null,
    ISessionVideoStreamingInputTelemetryEvents? videoStreamingInput = null,
    ISessionBrowseTelemetryEvents? browse = null,
    ISessionDomProjectionTelemetryEvents? domProjection = null) : ISessionTelemetryEventsFactory
{
    private readonly ISessionTelemetryEvents _events = new NoOpSessionTelemetryEvents(
        client ?? NoOp<ISessionClientTelemetryEvents>(),
        navigate ?? NoOp<ISessionNavigateTelemetryEvents>(),
        videoStreamingInput ?? NoOp<ISessionVideoStreamingInputTelemetryEvents>(),
        browse ?? NoOp<ISessionBrowseTelemetryEvents>(),
        domProjection ?? NoOp<ISessionDomProjectionTelemetryEvents>());

    public ISessionTelemetryEvents ForSession(Guid sessionId, Guid profileId) => _events;

    private sealed class NoOpSessionTelemetryEvents(
        ISessionClientTelemetryEvents client,
        ISessionNavigateTelemetryEvents navigate,
        ISessionVideoStreamingInputTelemetryEvents videoStreamingInput,
        ISessionBrowseTelemetryEvents browse,
        ISessionDomProjectionTelemetryEvents domProjection)
        : ISessionTelemetryEvents
    {
        public ISessionCapacityTelemetryEvents Capacity { get; } = NoOp<ISessionCapacityTelemetryEvents>();
        public ISessionStartTelemetryEvents Start { get; } = NoOp<ISessionStartTelemetryEvents>();
        public ISessionNavigateTelemetryEvents Navigate { get; } = navigate;
        public ISessionPersistTelemetryEvents Persist { get; } = NoOp<ISessionPersistTelemetryEvents>();
        public ISessionVideoStreamingInputTelemetryEvents VideoStreamingInput { get; } = videoStreamingInput;
        public ISessionDomProjectionTelemetryEvents DomProjection { get; } = domProjection;
        public ISessionResizeTelemetryEvents Resize { get; } = NoOp<ISessionResizeTelemetryEvents>();
        public ISessionBrowseTelemetryEvents Browse { get; } = browse;
        public ISessionClientTelemetryEvents Client { get; } = client;
        public ISessionSidecarTelemetryEvents Sidecar { get; } = NoOp<ISessionSidecarTelemetryEvents>();
    }

    private static T NoOp<T>() where T : class
        => DispatchProxy.Create<T, NoOpTelemetryProxy>();

    private class NoOpTelemetryProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => null;
    }
}
