using System.Text;
using System.Text.Json;
using Speculum.Api.BrowserProfiles.Aggregates;
using Speculum.Api.BrowserSessions.Models;
using Speculum.Api.Sidecar.V1;
using DomainDeviceProfile = Speculum.Api.BrowserSessions.Models.DeviceProfile;
using DomainEditingState = Speculum.Api.BrowserSessions.Models.EditingState;
using DomainResizeResult = Speculum.Api.BrowserSessions.Models.ResizeResult;
using ProtoDevice = Speculum.Api.Sidecar.V1.DeviceProfile;
using ProtoResizeResult = Speculum.Api.Sidecar.V1.ResizeResult;
using ProtoScript = Speculum.Api.Sidecar.V1.ScriptInjection;
using ProtoState = Speculum.Api.Sidecar.V1.BrowserState;

namespace Speculum.Api.BrowserClients.Grpc;

internal static class GrpcSessionMappers
{
    public static LaunchRequest ToLaunchRequest(Guid sessionId, SessionConfig? configuration)
    {
        var width = configuration?.Resolution?.Width ?? 1280;
        var height = configuration?.Resolution?.Height ?? 720;
        var request = new LaunchRequest
        {
            SessionId = sessionId.ToString("D"),
            Width = width,
            Height = height,
        };

        if (configuration?.Device is { } device)
        {
            request.Device = ToProtoDevice(device);
        }

        if (configuration?.Scripts is { Count: > 0 } scripts)
        {
            foreach (var s in scripts)
            {
                request.Scripts.Add(new ProtoScript
                {
                    Position = s.Position,
                    Type = s.Type,
                    File = s.File,
                    Content = s.Content,
                });
            }
        }

        if (configuration?.AllowedNavigationDomains is { Count: > 0 } domains)
        {
            request.AllowedNavigationDomains.AddRange(domains);
        }

        return request;
    }

    public static ProtoDevice ToProtoDevice(DomainDeviceProfile device) => new()
    {
        Mobile = device.Mobile,
        Touch = device.Touch,
        DeviceScaleFactor = device.DeviceScaleFactor,
        MaxTouchPoints = device.MaxTouchPoints,
        UserAgentProfile = device.UserAgentProfile ?? "",
        ScreenOrientation = device.ScreenOrientation ?? "",
    };

    public static BrowserReadyInfo ToReadyInfo(ReadyInfo ready) => new()
    {
        Width = ready.Width,
        Height = ready.Height,
    };

    public static DomainResizeResult ToResizeResult(string requestId, ProtoResizeResult r) => new()
    {
        Applied = r.Ok,
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
        DomainEditingState? editing) => new()
    {
        TabCount = status.TabCount,
        Url = status.Url,
        Resizing = status.Resizing,
        Width = status.Width,
        Height = status.Height,
        SessionId = sessionId.ToString("D"),
        Editing = editing,
    };

    public static ConsoleOutput ConsoleEventToOutput(ConsoleEvent ev) => new()
    {
        Data = Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { kind = "console", level = ev.Level, text = ev.Text })),
    };

    public static ConsoleOutput EvalResultToOutput(int id, EvaluateResult result) => new()
    {
        Data = Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new
            {
                kind = "eval",
                id,
                ok = result.Ok,
                value = result.Value,
                error = result.HasErrorMessage ? result.ErrorMessage : null,
            })),
    };

    public static bool TryParseInputEvent(Guid sessionId, string json, out InputEvent? input)
    {
        input = null;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!root.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var type = typeEl.GetString() ?? "";
        var sid = sessionId.ToString("D");
        input = type switch
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
}
