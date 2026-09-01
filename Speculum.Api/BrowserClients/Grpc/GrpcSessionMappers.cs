using System.Text.Json;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Sidecar.V1;
using DomainUrlMatchRule = Speculum.Api.Configurations.Models.Patterns.UrlMatchRule;
using DomainDeviceProfile = Speculum.Api.Sessions.Models.DeviceProfile;
using DomainEditingState = Speculum.Api.Sessions.Models.EditingState;
using DomainResizeResult = Speculum.Api.Sessions.Models.ResizeResult;
using DomainPageProjectionFrame = Speculum.Api.Sessions.Mirror.PageProjection.PageProjectionFrame;
using ProtoPageProjectionFrame = Speculum.Api.Sidecar.V1.PageProjectionFrame;
using ProtoDevice = Speculum.Api.Sidecar.V1.DeviceProfile;
using ProtoResizeResult = Speculum.Api.Sidecar.V1.ResizeResult;
using ProtoScript = Speculum.Api.Sidecar.V1.ScriptInjection;
using ProtoState = Speculum.Api.Sidecar.V1.BrowserState;
using ProtoGeolocation = Speculum.Api.Sidecar.V1.Geolocation;
using DomainCookieNormalizeStats = Speculum.Api.Sessions.Models.CookieNormalizeStats;
using ProtoCookieNormalizeStats = Speculum.Api.Sidecar.V1.CookieNormalizeStats;

namespace Speculum.Api.BrowserClients.Grpc;

internal static class GrpcSessionMappers
{
    public static LaunchVideoStreamingRequest ToLaunchVideoStreamingRequest(
        Guid sessionId,
        int width,
        int height,
        SessionConfig configuration,
        Speculum.Api.Configurations.Models.Sessions.ViewportPolicy policy,
        string requestHost,
        EngineConfiguration engineConfiguration,
        double screencastMaxEncodeScale = 2)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentNullException.ThrowIfNull(engineConfiguration);
        var request = new LaunchVideoStreamingRequest
        {
            SessionId = sessionId.ToString("D"),
            Width = width,
            Height = height,
            MinWidth = policy.Minimum.Width,
            MinHeight = policy.Minimum.Height,
            DisplayWidth = policy.Maximum.Width,
            DisplayHeight = policy.Maximum.Height,
            ScreencastMaxEncodeScale = ClampScreencastMaxEncodeScale(screencastMaxEncodeScale),
            NavigationPolicy = ToNavigationPolicy(engineConfiguration, requestHost),
        };
        ApplyCommonLaunchFields(request, configuration);
        return request;
    }

    public static LaunchPageProjectionRequest ToLaunchPageProjectionRequest(
        Guid sessionId,
        int width,
        int height,
        SessionConfig configuration,
        Speculum.Api.Configurations.Models.Sessions.ViewportPolicy policy,
        string requestHost,
        EngineConfiguration engineConfiguration,
        int frameQueueCapacity = PageProjectionFrameChannels.DefaultConnectionCapacity,
        Speculum.Api.Configurations.Models.Sessions.PageProjectionOptions? pageProjection = null)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentNullException.ThrowIfNull(engineConfiguration);
        var pp = pageProjection ?? new Speculum.Api.Configurations.Models.Sessions.PageProjectionOptions();
        var request = new LaunchPageProjectionRequest
        {
            SessionId = sessionId.ToString("D"),
            Width = width,
            Height = height,
            MinWidth = policy.Minimum.Width,
            MinHeight = policy.Minimum.Height,
            DisplayWidth = policy.Maximum.Width,
            DisplayHeight = policy.Maximum.Height,
            FrameQueueCapacity = ClampFrameQueueCapacity(
                frameQueueCapacity),
            FrameRateHz = Math.Max(0, pp.FrameRateHz),
            MaxFrameBytes = (int)Math.Clamp(pp.MaxFrameBytes, 0, int.MaxValue),
            BrowserPoolSize = Math.Max(0, pp.BrowserPoolSize),
            BrowserPoolRefillPerSec = Math.Max(0, pp.BrowserPoolRefillPerSec),
            HiddenRateHz = Math.Max(0, pp.HiddenRateHz),
            RateRecoverMs = Math.Max(0, pp.RateRecoverMs),
            FrameStallMs = Math.Max(0, pp.FrameStallMs),
            // establish_chunk_bytes / client_state_ms: removed M6.
            MirrorMaxBytes = Math.Max(0, pp.MirrorMaxBytes),
            AssetCacheL1MaxBytes = Math.Max(0, pp.AssetCacheL1MaxBytes),
            AssetCacheL2MaxBytes = Math.Max(0, pp.AssetCacheL2MaxBytes),
            AssetCacheL2Enabled = pp.AssetCacheL2Enabled,
            AssetPriorityViewportPx = Math.Max(0, pp.AssetPriorityViewportPx),
            AggregateIntervalMs = Math.Max(0, pp.AggregateIntervalMs),
            SwapTimeoutMs = Math.Max(0, pp.SwapTimeoutMs),
            ApplyBudgetMs = Math.Max(0, pp.ApplyBudgetMs),
            NavigationPolicy = ToNavigationPolicy(engineConfiguration, requestHost),
        };
        foreach (var hz in pp.FrameRateLadder)
        {
            if (hz > 0) request.FrameRateLadder.Add(hz);
        }

        ApplyCommonLaunchFields(request, configuration);
        return request;
    }

    private static void ApplyCommonLaunchFields(
        LaunchVideoStreamingRequest request,
        SessionConfig configuration)
    {
        var environment = configuration.ClientEnvironment
            ?? throw new ArgumentException(
                "SessionConfig.ClientEnvironment is required",
                nameof(configuration));
        request.Locale = environment.Locale;
        request.Language = environment.Language;
        request.TimezoneId = environment.TimeZoneId;
        request.ColorScheme = environment.ColorScheme;

        if (environment.Geolocation is { } geolocation)
        {
            request.Geolocation = new ProtoGeolocation
            {
                Latitude = geolocation.Latitude,
                Longitude = geolocation.Longitude,
                Accuracy = geolocation.Accuracy,
            };
        }

        if (configuration.Device is { } device)
        {
            request.Device = ToProtoDevice(device);
        }

        if (configuration.Scripts is { Count: > 0 } scripts)
        {
            foreach (var s in scripts)
            {
                request.Scripts.Add(new ProtoScript
                {
                    Type = s.Type,
                    File = s.File,
                    Content = s.Content ?? "",
                    RemoteUrl = s.RemoteUrl ?? "",
                });
                request.Scripts[^1].TargetRules.AddRange(s.TargetRules.Select(ToProtoUrlMatchRule));
            }
        }

        if (configuration.AllowedNavigationDomains is { Count: > 0 } domains)
        {
            request.AllowedNavigationDomains.AddRange(domains);
        }

        request.CpuProfiling = configuration.CpuProfiling;
    }

    private static void ApplyCommonLaunchFields(
        LaunchPageProjectionRequest request,
        SessionConfig configuration)
    {
        var environment = configuration.ClientEnvironment
            ?? throw new ArgumentException(
                "SessionConfig.ClientEnvironment is required",
                nameof(configuration));
        request.Locale = environment.Locale;
        request.Language = environment.Language;
        request.TimezoneId = environment.TimeZoneId;
        request.ColorScheme = environment.ColorScheme;

        if (environment.Geolocation is { } geolocation)
        {
            request.Geolocation = new ProtoGeolocation
            {
                Latitude = geolocation.Latitude,
                Longitude = geolocation.Longitude,
                Accuracy = geolocation.Accuracy,
            };
        }

        if (configuration.Device is { } device)
        {
            request.Device = ToProtoDevice(device);
        }

        if (configuration.Scripts is { Count: > 0 } scripts)
        {
            foreach (var s in scripts)
            {
                request.Scripts.Add(new ProtoScript
                {
                    Type = s.Type,
                    File = s.File,
                    Content = s.Content ?? "",
                    RemoteUrl = s.RemoteUrl ?? "",
                });
                request.Scripts[^1].TargetRules.AddRange(s.TargetRules.Select(ToProtoUrlMatchRule));
            }
        }

        if (configuration.AllowedNavigationDomains is { Count: > 0 } domains)
        {
            request.AllowedNavigationDomains.AddRange(domains);
        }

        request.CpuProfiling = configuration.CpuProfiling;
    }

    public static double ClampScreencastMaxEncodeScale(double value)
    {
        if (!double.IsFinite(value) || value <= 0)
        {
            return 2;
        }

        return Math.Clamp(value, 1, 2);
    }

    public static int ClampFrameQueueCapacity(int value)
    {
        if (value < 64)
        {
            return PageProjectionFrameChannels.DefaultConnectionCapacity;
        }

        return Math.Clamp(value, 64, 65_536);
    }

    /// <summary>Wire form for LaunchRequest.mirror_mode (camelCase enum name).</summary>
    public static string ToMirrorModeWire(
        Speculum.Api.Configurations.Models.Sessions.MirrorMode mode)
        => mode switch
        {
            Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection => "pageProjection",
            _ => "videoStreaming",
        };

    public static ProtoDevice? TryToProtoDevice(DomainDeviceProfile device)
    {
        if (!GrpcRequestValidation.HasExplicitDevice(device))
        {
            return null;
        }

        return ToProtoDevice(device);
    }

    public static ProtoDevice ToProtoDevice(DomainDeviceProfile device)
    {
        var proto = new ProtoDevice
        {
            Mobile = device.Mobile,
            Touch = device.Touch,
            DeviceScaleFactor = device.DeviceScaleFactor,
            MaxTouchPoints = device.MaxTouchPoints,
        };

        if (!string.IsNullOrWhiteSpace(device.UserAgentProfile))
        {
            proto.UserAgentProfile = device.UserAgentProfile;
        }

        if (!string.IsNullOrWhiteSpace(device.DeviceCategory))
        {
            proto.DeviceCategory = device.DeviceCategory;
        }

        if (!string.IsNullOrWhiteSpace(device.ScreenOrientation))
        {
            proto.ScreenOrientation = device.ScreenOrientation;
        }

        return proto;
    }

    private static Sidecar.V1.NavigationPolicy ToNavigationPolicy(
        EngineConfiguration engineConfiguration,
        string requestHost)
    {
        ArgumentNullException.ThrowIfNull(engineConfiguration);
        if (string.IsNullOrWhiteSpace(requestHost))
        {
            throw new ArgumentException("Request host is required", nameof(requestHost));
        }

        var policy = new Sidecar.V1.NavigationPolicy
        {
            RequestHost = requestHost.Trim(),
            DefaultTargetHost = engineConfiguration.Navigation.DefaultTargetHost.Trim().ToLowerInvariant(),
            NavigationStateParam = UrlResolver.NavigationStateParameterName,
        };

        foreach (var domain in engineConfiguration.Hosting.Domains)
        {
            policy.Domains.Add(new Sidecar.V1.NavigationPolicyDomain
            {
                Domain = domain.Domain.Trim().ToLowerInvariant(),
                IsSubdomainMirroringEnabled = domain.IsSubdomainMirroringEnabled,
            });
        }

        foreach (var rule in engineConfiguration.Navigation.AllowedMainFrameUrls)
        {
            policy.AllowedMainFrameUrls.Add(ToProtoUrlMatchRule(rule));
        }

        return policy;
    }

    private static Sidecar.V1.UrlMatchRule ToProtoUrlMatchRule(DomainUrlMatchRule rule) => new()
    {
        Domain = new Sidecar.V1.DomainPattern
        {
            Scope = rule.Domain.Scope.ToString(),
            Labels = { rule.Domain.Labels.Select(label => new Sidecar.V1.DomainLabelPattern
            {
                Match = label.Match.ToString(),
                Value = label.Value,
            }) },
        },
        Path = new Sidecar.V1.PathPattern
        {
            Scope = rule.Path.Scope.ToString(),
            MatchType = rule.Path.MatchType.ToString(),
            Segments = { rule.Path.Segments.Select(segment => new Sidecar.V1.PathSegmentPattern
            {
                Match = segment.Match.ToString(),
                Value = segment.Value,
            }) },
        },
    };

    public static BrowserReadyInfo ToReadyInfo(ReadyInfo ready) => new()
    {
        Width = ready.Width,
        Height = ready.Height,
    };

    public static DomainResizeResult ToResizeResult(string requestId, ProtoResizeResult r)
    {
        var applied = r.Ok;
        var outcome = applied
            ? ResizeOutcome.Applied
            : string.Equals(r.HasErrorCode ? r.ErrorCode : null, "resize_busy", StringComparison.Ordinal)
                ? ResizeOutcome.Busy
                : string.IsNullOrWhiteSpace(r.HasErrorCode ? r.ErrorCode : null)
                    ? ResizeOutcome.Failed
                    : ResizeOutcome.Rejected;

        return new()
        {
            Applied = applied,
            Outcome = outcome,
            Width = r.Width,
            Height = r.Height,
            ChromeWidth = r.HasChromeWidth ? r.ChromeWidth : null,
            ChromeHeight = r.HasChromeHeight ? r.ChromeHeight : null,
            DisplayWidth = r.HasDisplayWidth ? r.DisplayWidth : null,
            DisplayHeight = r.HasDisplayHeight ? r.DisplayHeight : null,
            ResizeId = requestId,
            ErrorCode = r.HasErrorCode ? r.ErrorCode : null,
            Phase = r.HasPhase ? r.Phase : null,
            Message = r.HasMessage ? r.Message : null,
        };
    }

    public static DiagProbeResult ToProbeResult(ProbeResult r)
    {
        JsonElement? data = null;
        if (r.Ok && r.HasDataJson && !string.IsNullOrWhiteSpace(r.DataJson))
        {
            using var doc = JsonDocument.Parse(r.DataJson);
            data = doc.RootElement.Clone();
        }

        return new DiagProbeResult
        {
            Ok = r.Ok,
            Data = data,
            ErrorCode = r.HasErrorCode ? r.ErrorCode : null,
            Message = r.HasMessage ? r.Message : null,
        };
    }

    public static RestoreStateRequest ToRestoreRequest(Guid sessionId, ProfileState state) => new()
    {
        SessionId = sessionId.ToString("D"),
        State = ToProtoState(state),
    };

    public static DomainCookieNormalizeStats ToCookieNormalizeStats(ProtoCookieNormalizeStats? proto)
    {
        if (proto is null)
            return DomainCookieNormalizeStats.Empty;

        return new DomainCookieNormalizeStats
        {
            Total = proto.Total,
            Skipped = proto.Skipped,
            Normalized = proto.Normalized,
            Applied = proto.Applied,
            FailedIndividual = proto.FailedIndividual,
        };
    }

    public static SessionState ToSessionState(ProtoState state) => new()
    {
        Cookies = state.Cookies.Select(c => new BrowserCookieState
        {
            Name = c.Name,
            Value = c.Value,
            Domain = c.Domain,
            Path = c.Path,
            Expires = c.HasExpires ? c.Expires : null,
            HttpOnly = c.HttpOnly,
            Secure = c.Secure,
            SameSite = c.HasSameSite ? c.SameSite : null,
        }).ToList(),
        LocalStorage = state.LocalStorage.Select(ls => new BrowserLocalStorageState
        {
            Origin = ls.Origin,
            Key = ls.Key,
            Value = ls.Value,
        }).ToList(),
        IdbRecords = state.IdbRecords.Select(r => new BrowserIdbRecordState
        {
            Origin = r.Origin,
            DatabaseName = r.DatabaseName,
            StoreName = r.StoreName,
            KeyJson = r.KeyJson,
            ValueJson = r.ValueJson,
        }).ToList(),
        History = state.History.Select(h => new BrowserHistoryState
        {
            Url = h.Url,
            Title = h.Title ?? "",
            VisitedAtMs = h.VisitedAtMs,
            TransitionType = h.TransitionType ?? "",
            IndexOrder = h.IndexOrder,
        }).ToList(),
    };

    public static ProtoState ToProtoState(ProfileState state)
    {
        var proto = new ProtoState();
        foreach (var c in state.Cookies)
        {
            var cookie = new CookieState
            {
                Name = c.Name,
                Value = c.Value,
                Domain = c.Domain,
                Path = c.Path,
                HttpOnly = c.HttpOnly,
                Secure = c.Secure,
            };
            if (c.Expires is { } expires) cookie.Expires = expires;
            if (!string.IsNullOrEmpty(c.SameSite)) cookie.SameSite = c.SameSite;
            proto.Cookies.Add(cookie);
        }

        foreach (var ls in state.LocalStorage)
        {
            proto.LocalStorage.Add(new LocalStorageState
            {
                Origin = ls.Origin,
                Key = ls.Key,
                Value = ls.Value,
            });
        }

        foreach (var r in state.IdbRecords)
        {
            proto.IdbRecords.Add(new IdbRecordState
            {
                Origin = r.Origin,
                DatabaseName = r.DatabaseName,
                StoreName = r.StoreName,
                KeyJson = r.KeyJson,
                ValueJson = r.ValueJson,
            });
        }

        foreach (var h in state.History)
        {
            proto.History.Add(new HistoryState
            {
                Url = h.Url,
                Title = h.Title,
                VisitedAtMs = h.VisitedAtMs,
                TransitionType = h.TransitionType,
                IndexOrder = h.IndexOrder,
            });
        }

        return proto;
    }

    public static SessionStatus ToSessionStatus(
        Guid sessionId,
        Status status,
        DomainEditingState? editing,
        double fps) => new()
    {
        TabCount = status.TabCount,
        Url = status.Url,
        Resizing = status.Resizing,
        Width = status.Width,
        Height = status.Height,
        DisplayWidth = status.DisplayWidth,
        DisplayHeight = status.DisplayHeight,
        ChromeWidth = status.ChromeWidth,
        ChromeHeight = status.ChromeHeight,
        Fps = fps,
        SessionId = sessionId.ToString("D"),
        Editing = editing,
    };

    public static ConsoleOutput ConsoleEventToOutput(ConsoleEvent ev) => new()
    {
        Kind = ConsoleOutputKind.Console,
        Level = ev.Level,
        Text = ev.Text,
    };

    public static ConsoleOutput EvalResultToOutput(int id, EvaluateResult result) => new()
    {
        Kind = ConsoleOutputKind.EvalResult,
        RequestId = id,
        Ok = result.Ok,
        Value = result.Value,
        Error = result.HasErrorMessage ? result.ErrorMessage : null,
    };

    public static bool TryParseInputEvent(
        Guid sessionId,
        VideoStreamingInput userInput,
        out InputEvent? input)
    {
        input = null;
        if (string.IsNullOrWhiteSpace(userInput.Type)
            || string.IsNullOrWhiteSpace(userInput.Payload))
        {
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(userInput.Payload);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || (root.TryGetProperty("type", out var typeEl)
                    && (typeEl.ValueKind != JsonValueKind.String
                        || !string.Equals(
                            typeEl.GetString(),
                            userInput.Type,
                            StringComparison.Ordinal))))
            {
                return false;
            }

            var sid = sessionId.ToString("D");
            input = userInput.Type switch
            {
            "mousemove" => new InputEvent
            {
                SessionId = sid,
                MouseMove = new MouseMove { X = root.GetProperty("x").GetDouble(), Y = root.GetProperty("y").GetDouble() },
            },
            "mousedown" => new InputEvent
            {
                SessionId = sid,
                MouseDown = new MouseButton
                {
                    X = root.GetProperty("x").GetDouble(),
                    Y = root.GetProperty("y").GetDouble(),
                    Button = root.GetProperty("button").GetInt32(),
                },
            },
            "mouseup" => new InputEvent
            {
                SessionId = sid,
                MouseUp = new MouseButton
                {
                    X = root.GetProperty("x").GetDouble(),
                    Y = root.GetProperty("y").GetDouble(),
                    Button = root.GetProperty("button").GetInt32(),
                },
            },
            "wheel" => new InputEvent
            {
                SessionId = sid,
                Wheel = new Wheel
                {
                    X = root.GetProperty("x").GetDouble(),
                    Y = root.GetProperty("y").GetDouble(),
                    DeltaX = root.TryGetProperty("deltaX", out var dx) ? dx.GetDouble() : 0,
                    DeltaY = root.TryGetProperty("deltaY", out var dy) ? dy.GetDouble() : 0,
                },
            },
            "keydown" => new InputEvent
            {
                SessionId = sid,
                KeyDown = new Key { Key_ = root.GetProperty("key").GetString() ?? "" },
            },
            "keyup" => new InputEvent
            {
                SessionId = sid,
                KeyUp = new Key { Key_ = root.GetProperty("key").GetString() ?? "" },
            },
            "type" => new InputEvent
            {
                SessionId = sid,
                Type = new TypeText { Text = root.GetProperty("text").GetString() ?? "" },
            },
            "text" => new InputEvent
            {
                SessionId = sid,
                Text = new TextInput
                {
                    Text = root.GetProperty("text").GetString() ?? "",
                    Source = root.TryGetProperty("source", out var src) ? src.GetString() ?? "" : "",
                },
            },
            "touch" => ParseTouch(sid, root),
            "goback" => new InputEvent { SessionId = sid, Goback = new HistoryNav() },
            "goforward" => new InputEvent { SessionId = sid, Goforward = new HistoryNav() },
            _ => null,
            };
            return input is not null;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        catch (KeyNotFoundException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static InputEvent ParseTouch(string sid, JsonElement root)
    {
        var touch = new Touch
        {
            Phase = root.GetProperty("phase").GetString() ?? "start",
        };
        if (root.TryGetProperty("points", out var points) && points.ValueKind == JsonValueKind.Array)
        {
            foreach (var p in points.EnumerateArray())
            {
                touch.Points.Add(new TouchPoint
                {
                    Id = p.GetProperty("id").GetInt32(),
                    X = p.GetProperty("x").GetDouble(),
                    Y = p.GetProperty("y").GetDouble(),
                    RadiusX = p.TryGetProperty("radiusX", out var rx) ? rx.GetDouble() : 1,
                    RadiusY = p.TryGetProperty("radiusY", out var ry) ? ry.GetDouble() : 1,
                    Force = p.TryGetProperty("force", out var f) ? f.GetDouble() : 0.5,
                });
            }
        }

        if (root.TryGetProperty("changedIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
        {
            foreach (var id in ids.EnumerateArray())
            {
                touch.ChangedIds.Add(id.GetInt32());
            }
        }

        return new InputEvent { SessionId = sid, Touch = touch };
    }

    /// <summary>
    /// Maps a sidecar Diff frame to the API wire shape (PP-WIRE-1 / M4). Relays
    /// <see cref="DomainPageProjectionFrame.Body"/> opaquely — never parses motor payload.
    /// </summary>
    public static DomainPageProjectionFrame? ToPageProjectionFrame(ProtoPageProjectionFrame frame)
    {
        if (frame.Body.IsEmpty)
        {
            return null;
        }

        var plane = string.Empty;
        var operation = string.Empty;

        return new DomainPageProjectionFrame
        {
            Sequence = frame.Sequence,
            Generation = frame.Generation,
            Timestamp = frame.TimestampMs,
            Plane = plane,
            Operation = operation,
            Body = frame.Body.ToByteArray(),
            PartIndex = frame.PartIndex,
            PartCount = frame.PartCount == 0 ? 1 : frame.PartCount,
            Flags = frame.Flags,
            Version = frame.Version == 0 ? 1 : frame.Version,
            ContextId = frame.ContextId == 0 ? 1 : frame.ContextId,
        };
    }

    public static bool TryParseDomInputEvent(
        Guid sessionId,
        PageProjectionIntent input,
        out DomInputEvent? domInput)
    {
        domInput = null;
        if (string.IsNullOrWhiteSpace(input.Type))
        {
            return false;
        }

        // Wire click is forbidden — gesture is pressed/released only.
        if (string.Equals(input.Type.Trim(), "click", StringComparison.OrdinalIgnoreCase)
            || string.Equals(input.Type.Trim(), "auxclick", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var mapped = new DomInputEvent
        {
            SessionId = sessionId.ToString("D"),
            Type = input.Type.Trim(),
            PayloadJson = string.IsNullOrWhiteSpace(input.Payload) ? "{}" : input.Payload,
            Generation = input.Generation,
            TimestampClient = input.TimestampClient ?? 0,
        };
        if (input.TargetId is { } targetId)
        {
            mapped.TargetId = targetId;
        }
        if (input.ContextId > 0)
        {
            mapped.ContextId = input.ContextId;
        }
        if (input.SchemaVersion > 0)
        {
            mapped.SchemaVersion = input.SchemaVersion;
        }
        if (input.ViewportW is { } vw)
        {
            mapped.ViewportW = vw;
        }
        if (input.ViewportH is { } vh)
        {
            mapped.ViewportH = vh;
        }
        if (!string.IsNullOrWhiteSpace(input.Census))
        {
            mapped.Census = input.Census;
        }

        domInput = mapped;
        return true;
    }

    public static VirtualResourceResponse ToVirtualResourceResponse(GetDomAssetResponse response) => new()
    {
        Body = response.Body.ToByteArray(),
        ContentType = string.IsNullOrWhiteSpace(response.ContentType)
            ? "application/octet-stream"
            : response.ContentType,
        StatusCode = response.StatusCode == 0 ? 200 : response.StatusCode,
        ContentRange = string.IsNullOrWhiteSpace(response.ContentRange) ? null : response.ContentRange,
        PassThrough = response.PassThrough,
        RequestHadCookie = response.RequestHadCookie,
        RequestHadAuthorization = response.RequestHadAuthorization,
        CacheControl = string.IsNullOrWhiteSpace(response.CacheControl) ? null : response.CacheControl,
        Vary = string.IsNullOrWhiteSpace(response.Vary) ? null : response.Vary,
    };
}
