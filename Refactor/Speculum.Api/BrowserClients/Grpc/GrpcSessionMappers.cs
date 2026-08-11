using System.Text.Json;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Sidecar.V1;
using DomainUrlMatchRule = Speculum.Api.Configurations.Models.Patterns.UrlMatchRule;
using DomainDeviceProfile = Speculum.Api.Sessions.Models.DeviceProfile;
using DomainEditingState = Speculum.Api.Sessions.Models.EditingState;
using DomainResizeResult = Speculum.Api.Sessions.Models.ResizeResult;
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
    public static LaunchRequest ToLaunchRequest(
        Guid sessionId,
        int width,
        int height,
        SessionConfig configuration,
        Speculum.Api.Configurations.Models.Sessions.ViewportPolicy policy,
        double screencastMaxEncodeScale = 2,
        Speculum.Api.Configurations.Models.Sessions.MirrorMode mirrorMode =
            Speculum.Api.Configurations.Models.Sessions.MirrorMode.VideoStreaming,
        int pageProjectionDiffQueueCapacity = SequencedDiffChannels.DefaultCapacity)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(policy);
        var request = new LaunchRequest
        {
            SessionId = sessionId.ToString("D"),
            Width = width,
            Height = height,
            MinWidth = policy.Minimum.Width,
            MinHeight = policy.Minimum.Height,
            DisplayWidth = policy.Maximum.Width,
            DisplayHeight = policy.Maximum.Height,
            ScreencastMaxEncodeScale = ClampScreencastMaxEncodeScale(screencastMaxEncodeScale),
            MirrorMode = ToMirrorModeWire(mirrorMode),
            PageProjectionDiffQueueCapacity = ClampPageProjectionDiffQueueCapacity(
                pageProjectionDiffQueueCapacity),
        };

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
                    Position = s.Position,
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

        return request;
    }

    public static double ClampScreencastMaxEncodeScale(double value)
    {
        if (!double.IsFinite(value) || value <= 0)
        {
            return 2;
        }

        return Math.Clamp(value, 1, 2);
    }

    public static int ClampPageProjectionDiffQueueCapacity(int value)
    {
        if (value < 64)
        {
            return SequencedDiffChannels.DefaultCapacity;
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

    public static PageProjectionDiff? ToPageProjectionDiff(PageProjectionDiffFrame frame)
    {
        var plane = (frame.Plane ?? string.Empty).Trim();
        var operation = (frame.Operation ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(plane) || string.IsNullOrWhiteSpace(operation))
        {
            return null;
        }

        if (!string.Equals(plane, "dom", StringComparison.Ordinal)
            && !string.Equals(plane, "cssom", StringComparison.Ordinal))
        {
            return null;
        }

        JsonElement body = default;
        var hasBody = false;
        if (!frame.Body.IsEmpty)
        {
            try
            {
                using var doc = JsonDocument.Parse(frame.Body.ToByteArray());
                body = doc.RootElement.Clone();
                hasBody = true;
            }
            catch (JsonException)
            {
                return null;
            }
        }

        PageProjectionDocumentPayload? document = null;
        PageProjectionChildListPayload? childList = null;
        PageProjectionPatchPayload? patch = null;
        PageProjectionScrollViewportPayload? scrollViewport = null;
        PageProjectionScrollElementPayload? scrollElement = null;
        PageProjectionCssomInstallPayload? install = null;
        PageProjectionCssomSheetListPayload? sheetList = null;
        PageProjectionCssomRuleListPayload? ruleList = null;
        PageProjectionCssomPatchPayload? cssomPatch = null;

        if (string.Equals(plane, "dom", StringComparison.Ordinal))
        {
            switch (operation)
            {
                case "document":
                    if (!hasBody || !body.TryGetProperty("root", out var rootEl))
                    {
                        return null;
                    }

                    if (ParseDomNode(rootEl) is not { } root)
                    {
                        return null;
                    }

                    document = new PageProjectionDocumentPayload { Root = root };
                    break;
                case "childList":
                    if (!hasBody || ParseDomSelector(body, "selector") is not { } parentSel)
                    {
                        return null;
                    }

                    if (ParseRemovedEntries(body) is not { } removed
                        || ParseAddedEntries(body) is not { } added)
                    {
                        return null;
                    }

                    childList = new PageProjectionChildListPayload
                    {
                        Selector = parentSel,
                        Removed = removed,
                        Added = added,
                    };
                    break;
                case "patch":
                    if (!hasBody
                        || ParseDomSelector(body, "selector") is not { } patchSel
                        || !body.TryGetProperty("node", out var nodeEl)
                        || ParseDomNode(nodeEl) is not { } patchNode)
                    {
                        return null;
                    }

                    // Patch snapshots omit children.
                    patch = new PageProjectionPatchPayload
                    {
                        Selector = patchSel,
                        Node = new DomNode
                        {
                            Anchor = patchNode.Anchor,
                            Tag = patchNode.Tag,
                            Attrs = patchNode.Attrs,
                            Text = patchNode.Text,
                            Children = null,
                        },
                    };
                    break;
                case "scrollViewport":
                    if (!hasBody)
                    {
                        return null;
                    }

                    scrollViewport = new PageProjectionScrollViewportPayload
                    {
                        ScrollX = ReadDouble(body, "scrollX"),
                        ScrollY = ReadDouble(body, "scrollY"),
                    };
                    break;
                case "scrollElement":
                    if (!hasBody || ParseDomSelector(body, "selector") is not { } scrollSel)
                    {
                        return null;
                    }

                    scrollElement = new PageProjectionScrollElementPayload
                    {
                        Selector = scrollSel,
                        ScrollTop = ReadDouble(body, "scrollTop"),
                        ScrollLeft = ReadDouble(body, "scrollLeft"),
                    };
                    break;
                default:
                    return null;
            }
        }
        else
        {
            switch (operation)
            {
                case "install":
                    if (!hasBody || ParseCssomSheets(body) is not { } sheets)
                    {
                        return null;
                    }

                    install = new PageProjectionCssomInstallPayload { Sheets = sheets };
                    break;
                case "sheetList":
                    if (!hasBody
                        || ParseCssomRemoved(body) is not { } cssomRemoved
                        || ParseCssomAddedSheets(body) is not { } cssomAddedSheets)
                    {
                        return null;
                    }

                    sheetList = new PageProjectionCssomSheetListPayload
                    {
                        Removed = cssomRemoved,
                        Added = cssomAddedSheets,
                    };
                    break;
                case "ruleList":
                    if (!hasBody || ParseCssomSelector(body, "selector") is not { } sheetSel)
                    {
                        return null;
                    }

                    if (ParseCssomRemoved(body) is not { } ruleRemoved
                        || ParseCssomAddedRules(body) is not { } ruleAdded)
                    {
                        return null;
                    }

                    ruleList = new PageProjectionCssomRuleListPayload
                    {
                        Selector = sheetSel,
                        Removed = ruleRemoved,
                        Added = ruleAdded,
                    };
                    break;
                case "patch":
                    if (!hasBody
                        || ParseCssomSelector(body, "selector") is not { } ruleSel
                        || !body.TryGetProperty("rule", out var ruleEl)
                        || ParseCssomRule(ruleEl) is not { } rule)
                    {
                        return null;
                    }

                    cssomPatch = new PageProjectionCssomPatchPayload
                    {
                        Selector = ruleSel,
                        Rule = rule,
                    };
                    break;
                default:
                    return null;
            }
        }

        return new PageProjectionDiff
        {
            Sequence = frame.Sequence,
            Generation = frame.Generation,
            Timestamp = frame.TimestampMs,
            Plane = plane,
            Operation = operation,
            Document = document,
            ChildList = childList,
            Patch = patch,
            ScrollViewport = scrollViewport,
            ScrollElement = scrollElement,
            Install = install,
            SheetList = sheetList,
            RuleList = ruleList,
            CssomPatch = cssomPatch,
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

        domInput = new DomInputEvent
        {
            SessionId = sessionId.ToString("D"),
            Type = input.Type.Trim(),
            Anchor = input.Anchor ?? "",
            PayloadJson = string.IsNullOrWhiteSpace(input.Payload) ? "{}" : input.Payload,
            Generation = input.Generation,
            TimestampClient = input.TimestampClient ?? 0,
        };
        return true;
    }

    public static DomAsset ToDomAsset(GetDomAssetResponse response) => new()
    {
        Body = response.Body.ToByteArray(),
        ContentType = string.IsNullOrWhiteSpace(response.ContentType)
            ? "application/octet-stream"
            : response.ContentType,
        StatusCode = response.StatusCode == 0 ? 200 : response.StatusCode,
        ContentRange = string.IsNullOrWhiteSpace(response.ContentRange) ? null : response.ContentRange,
        PassThrough = response.PassThrough,
    };

    private static DomSelectorWire? ParseDomSelector(JsonElement parent, string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var selEl) || selEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var kind = ReadOptionalString(selEl, "kind");
        var query = ReadOptionalString(selEl, "query");
        if (string.IsNullOrWhiteSpace(kind) || string.IsNullOrWhiteSpace(query))
        {
            return null;
        }

        int? index = null;
        if (selEl.TryGetProperty("index", out var indexEl)
            && indexEl.ValueKind == JsonValueKind.Number
            && indexEl.TryGetInt32(out var i))
        {
            index = i;
        }

        // T7: exclusive variants — element{query} | childAt{query,index}.
        if (string.Equals(kind, "element", StringComparison.Ordinal))
        {
            if (index is not null)
            {
                return null;
            }
        }
        else if (string.Equals(kind, "childAt", StringComparison.Ordinal))
        {
            if (index is null || index < 0)
            {
                return null;
            }
        }
        else
        {
            return null;
        }

        return new DomSelectorWire
        {
            Kind = kind,
            Query = query,
            Index = index,
        };
    }

    /// <summary>
    /// Parse childList <c>removed</c>. Missing property ⇒ empty list.
    /// Malformed entry ⇒ null (reject envelope — T4/T6, no soft-skip).
    /// </summary>
    private static List<PageProjectionRemovedEntry>? ParseRemovedEntries(JsonElement body)
    {
        if (!body.TryGetProperty("removed", out var removedEl))
        {
            return [];
        }

        if (removedEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<PageProjectionRemovedEntry>();
        foreach (var entry in removedEl.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || ParseDomSelector(entry, "selector") is not { } sel)
            {
                return null;
            }

            list.Add(new PageProjectionRemovedEntry { Selector = sel });
        }

        return list;
    }

    /// <summary>
    /// Parse childList <c>added</c>. Missing property ⇒ empty list.
    /// Malformed entry ⇒ null (reject envelope — T4/T6, no soft-skip).
    /// </summary>
    private static List<PageProjectionAddedEntry>? ParseAddedEntries(JsonElement body)
    {
        if (!body.TryGetProperty("added", out var addedEl))
        {
            return [];
        }

        if (addedEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<PageProjectionAddedEntry>();
        foreach (var entry in addedEl.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("node", out var nodeEl)
                || ParseDomNode(nodeEl) is not { } node)
            {
                return null;
            }

            var index = 0;
            if (entry.TryGetProperty("index", out var indexEl))
            {
                if (indexEl.ValueKind != JsonValueKind.Number || !indexEl.TryGetInt32(out var i) || i < 0)
                {
                    return null;
                }

                index = i;
            }

            list.Add(new PageProjectionAddedEntry { Index = index, Node = node });
        }

        return list;
    }

    private static CssomSelectorWire? ParseCssomSelector(JsonElement parent, string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var selEl) || selEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var kind = ReadOptionalString(selEl, "kind");
        var id = ReadOptionalString(selEl, "id");
        if (string.IsNullOrWhiteSpace(kind) || string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return new CssomSelectorWire { Kind = kind, Id = id };
    }

    private static List<CssomSheetWire>? ParseCssomSheets(JsonElement body)
    {
        if (!body.TryGetProperty("sheets", out var sheetsEl) || sheetsEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var sheets = new List<CssomSheetWire>();
        foreach (var sheetEl in sheetsEl.EnumerateArray())
        {
            if (ParseCssomSheet(sheetEl) is not { } sheet)
            {
                return null;
            }

            sheets.Add(sheet);
        }

        return sheets;
    }

    private static CssomSheetWire? ParseCssomSheet(JsonElement sheetEl)
    {
        if (sheetEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var id = ReadOptionalString(sheetEl, "id");
        if (string.IsNullOrWhiteSpace(id)
            || !sheetEl.TryGetProperty("scope", out var scopeEl)
            || ParseCssomScope(scopeEl) is not { } scope)
        {
            return null;
        }

        var rules = new List<CssomRuleWire>();
        if (sheetEl.TryGetProperty("rules", out var rulesEl))
        {
            if (rulesEl.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var ruleEl in rulesEl.EnumerateArray())
            {
                if (ParseCssomRule(ruleEl) is not { } rule)
                {
                    return null;
                }

                rules.Add(rule);
            }
        }

        return new CssomSheetWire { Id = id, Scope = scope, Rules = rules };
    }

    private static CssomScopeWire? ParseCssomScope(JsonElement scopeEl)
    {
        if (scopeEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var kind = ReadOptionalString(scopeEl, "kind");
        if (string.IsNullOrWhiteSpace(kind))
        {
            return null;
        }

        return new CssomScopeWire
        {
            Kind = kind,
            HostAnchor = ReadOptionalString(scopeEl, "hostAnchor"),
        };
    }

    private static CssomRuleWire? ParseCssomRule(JsonElement ruleEl)
    {
        if (ruleEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var id = ReadOptionalString(ruleEl, "id");
        var cssText = ReadOptionalString(ruleEl, "cssText");
        if (string.IsNullOrWhiteSpace(id) || cssText is null)
        {
            return null;
        }

        return new CssomRuleWire { Id = id, CssText = cssText };
    }

    /// <summary>
    /// Parse Cssom <c>removed</c>. Missing property ⇒ empty list.
    /// Malformed entry ⇒ null (reject envelope — no soft-skip).
    /// </summary>
    private static List<PageProjectionCssomRemovedEntry>? ParseCssomRemoved(JsonElement body)
    {
        if (!body.TryGetProperty("removed", out var removedEl))
        {
            return [];
        }

        if (removedEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<PageProjectionCssomRemovedEntry>();
        foreach (var entry in removedEl.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || ParseCssomSelector(entry, "selector") is not { } sel)
            {
                return null;
            }

            list.Add(new PageProjectionCssomRemovedEntry { Selector = sel });
        }

        return list;
    }

    private static List<PageProjectionCssomAddedSheetEntry>? ParseCssomAddedSheets(JsonElement body)
    {
        if (!body.TryGetProperty("added", out var addedEl))
        {
            return [];
        }

        if (addedEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<PageProjectionCssomAddedSheetEntry>();
        foreach (var entry in addedEl.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("sheet", out var sheetEl)
                || ParseCssomSheet(sheetEl) is not { } sheet)
            {
                return null;
            }

            var index = 0;
            if (entry.TryGetProperty("index", out var indexEl))
            {
                if (indexEl.ValueKind != JsonValueKind.Number || !indexEl.TryGetInt32(out var i) || i < 0)
                {
                    return null;
                }

                index = i;
            }

            list.Add(new PageProjectionCssomAddedSheetEntry { Index = index, Sheet = sheet });
        }

        return list;
    }

    private static List<PageProjectionCssomAddedRuleEntry>? ParseCssomAddedRules(JsonElement body)
    {
        if (!body.TryGetProperty("added", out var addedEl))
        {
            return [];
        }

        if (addedEl.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<PageProjectionCssomAddedRuleEntry>();
        foreach (var entry in addedEl.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("rule", out var ruleEl)
                || ParseCssomRule(ruleEl) is not { } rule)
            {
                return null;
            }

            var index = 0;
            if (entry.TryGetProperty("index", out var indexEl))
            {
                if (indexEl.ValueKind != JsonValueKind.Number || !indexEl.TryGetInt32(out var i) || i < 0)
                {
                    return null;
                }

                index = i;
            }

            list.Add(new PageProjectionCssomAddedRuleEntry { Index = index, Rule = rule });
        }

        return list;
    }

    private static double ReadDouble(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Number)
        {
            return 0;
        }

        return el.TryGetDouble(out var value) ? value : 0;
    }

    private static DomNode? ParseDomNode(JsonElement nodeEl)
    {
        if (nodeEl.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var tag = nodeEl.TryGetProperty("tag", out var tagEl) && tagEl.ValueKind == JsonValueKind.String
            ? tagEl.GetString() ?? ""
            : "";

        // Text nodes may omit anchor.
        var anchor = nodeEl.TryGetProperty("anchor", out var anchorEl)
            && anchorEl.ValueKind == JsonValueKind.String
            ? anchorEl.GetString() ?? ""
            : "";

        if (string.IsNullOrWhiteSpace(tag) && string.IsNullOrWhiteSpace(anchor)
            && !nodeEl.TryGetProperty("text", out _))
        {
            return null;
        }

        Dictionary<string, string>? attrs = null;
        if (nodeEl.TryGetProperty("attrs", out var attrsEl) && attrsEl.ValueKind == JsonValueKind.Object)
        {
            attrs = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var prop in attrsEl.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.String)
                {
                    attrs[prop.Name] = prop.Value.GetString() ?? "";
                }
            }
        }

        List<DomNode>? children = null;
        if (nodeEl.TryGetProperty("children", out var childrenEl))
        {
            if (childrenEl.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            children = [];
            foreach (var childEl in childrenEl.EnumerateArray())
            {
                // T4/T6: malformed child rejects the whole envelope — never soft-skip
                // (omitted child shifts F index space → ghost desync).
                if (ParseDomNode(childEl) is not { } child)
                {
                    return null;
                }

                children.Add(child);
            }
        }

        return new DomNode
        {
            Anchor = anchor,
            Tag = tag,
            Attrs = attrs,
            Text = ReadOptionalString(nodeEl, "text"),
            Children = children,
        };
    }

    private static string? ReadOptionalString(JsonElement element, string name)
        => element.TryGetProperty(name, out var valueEl) && valueEl.ValueKind == JsonValueKind.String
            ? valueEl.GetString()
            : null;
}
