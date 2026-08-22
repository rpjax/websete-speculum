using MessagePack;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// PageProjection outbound unit — Dom or Cssom plane (exclusive payload per operation).
/// </summary>
/// <remarks>
/// Transitional wire shape (<c>docs/page-projection/spec/engine-redesign.md</c> §5.5, §5.16).
/// <see cref="Plane"/>/<see cref="Operation"/> and the parsed payload properties below are
/// the V1 JSON-body scheme and are DEPRECATED for the redesigned binary wire. On the
/// redesigned path <see cref="Body"/> carries the opaque §5.5 binary frame/part and
/// <see cref="Plane"/>/<see cref="Operation"/> are empty; the API MUST NOT parse it
/// (PP-WIRE-1) — it only relays bytes plus the part/flags/version envelope below.
/// </remarks>
[MessagePackObject]
public sealed class PageProjectionFrame
{
    [Key("sequence")]
    public long Sequence { get; init; }

    [Key("generation")]
    public long Generation { get; init; }

    [Key("timestamp")]
    public long Timestamp { get; init; }

    /// <summary>dom | cssom. Deprecated for binary frames — empty string.</summary>
    [Key("plane")]
    public required string Plane { get; init; }

    /// <summary>
    /// Dom: document | childList | patch | scrollViewport | scrollElement.
    /// Cssom: install | sheetList | ruleList | patch.
    /// Deprecated for binary frames — empty string.
    /// </summary>
    [Key("operation")]
    public required string Operation { get; init; }

    /// <summary>Opaque §5.5 binary frame/part body for the redesigned wire. Never parsed by the API.</summary>
    [Key("body")]
    public byte[]? Body { get; init; }

    /// <summary>Part index within the frame (§5.5.3); 0 when the frame was not split.</summary>
    [Key("partIndex")]
    public uint PartIndex { get; init; }

    /// <summary>Total part count for the frame (§5.5.3); 1 when the frame was not split.</summary>
    [Key("partCount")]
    public uint PartCount { get; init; } = 1;

    /// <summary>Bit 0 establish, bit 1 resync — see sidecar <c>mirror/page/encode.ts</c>.</summary>
    [Key("flags")]
    public uint Flags { get; init; }

    /// <summary>Wire format version (§5.5); an unknown version desyncs (PP-WIRE-2).</summary>
    [Key("version")]
    public uint Version { get; init; } = 1;

    [Key("contextId")]
    public uint ContextId { get; init; } = 1;

    [Key("document")]
    public PageProjectionDocumentPayload? Document { get; init; }

    [Key("childList")]
    public PageProjectionChildListPayload? ChildList { get; init; }

    [Key("patch")]
    public PageProjectionPatchPayload? Patch { get; init; }

    [Key("scrollViewport")]
    public PageProjectionScrollViewportPayload? ScrollViewport { get; init; }

    [Key("scrollElement")]
    public PageProjectionScrollElementPayload? ScrollElement { get; init; }

    [Key("install")]
    public PageProjectionCssomInstallPayload? Install { get; init; }

    [Key("sheetList")]
    public PageProjectionCssomSheetListPayload? SheetList { get; init; }

    [Key("ruleList")]
    public PageProjectionCssomRuleListPayload? RuleList { get; init; }

    [Key("cssomPatch")]
    public PageProjectionCssomPatchPayload? CssomPatch { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionDocumentPayload
{
    [Key("root")]
    public required DomNode Root { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionChildListPayload
{
    [Key("selector")]
    public required DomSelectorWire Selector { get; init; }

    [Key("removed")]
    public List<PageProjectionRemovedEntry> Removed { get; init; } = [];

    [Key("added")]
    public List<PageProjectionAddedEntry> Added { get; init; } = [];
}

[MessagePackObject]
public sealed class PageProjectionRemovedEntry
{
    [Key("selector")]
    public required DomSelectorWire Selector { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionAddedEntry
{
    [Key("index")]
    public int Index { get; init; }

    [Key("node")]
    public required DomNode Node { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionPatchPayload
{
    [Key("selector")]
    public required DomSelectorWire Selector { get; init; }

    [Key("node")]
    public required DomNode Node { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionScrollViewportPayload
{
    [Key("scrollX")]
    public double ScrollX { get; init; }

    [Key("scrollY")]
    public double ScrollY { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionScrollElementPayload
{
    [Key("selector")]
    public required DomSelectorWire Selector { get; init; }

    [Key("scrollTop")]
    public double ScrollTop { get; init; }

    [Key("scrollLeft")]
    public double ScrollLeft { get; init; }
}

[MessagePackObject]
public sealed class DomSelectorWire
{
    [Key("kind")]
    public required string Kind { get; init; }

    [Key("query")]
    public required string Query { get; init; }

    [Key("index")]
    public int? Index { get; init; }
}

[MessagePackObject]
public sealed class CssomSelectorWire
{
    [Key("kind")]
    public required string Kind { get; init; }

    [Key("id")]
    public required string Id { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionCssomInstallPayload
{
    [Key("sheets")]
    public required List<CssomSheetWire> Sheets { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionCssomSheetListPayload
{
    [Key("removed")]
    public List<PageProjectionCssomRemovedEntry> Removed { get; init; } = [];

    [Key("added")]
    public List<PageProjectionCssomAddedSheetEntry> Added { get; init; } = [];
}

[MessagePackObject]
public sealed class PageProjectionCssomRuleListPayload
{
    [Key("selector")]
    public required CssomSelectorWire Selector { get; init; }

    [Key("removed")]
    public List<PageProjectionCssomRemovedEntry> Removed { get; init; } = [];

    [Key("added")]
    public List<PageProjectionCssomAddedRuleEntry> Added { get; init; } = [];
}

[MessagePackObject]
public sealed class PageProjectionCssomPatchPayload
{
    [Key("selector")]
    public required CssomSelectorWire Selector { get; init; }

    [Key("rule")]
    public required CssomRuleWire Rule { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionCssomRemovedEntry
{
    [Key("selector")]
    public required CssomSelectorWire Selector { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionCssomAddedSheetEntry
{
    [Key("index")]
    public int Index { get; init; }

    [Key("sheet")]
    public required CssomSheetWire Sheet { get; init; }
}

[MessagePackObject]
public sealed class PageProjectionCssomAddedRuleEntry
{
    [Key("index")]
    public int Index { get; init; }

    [Key("rule")]
    public required CssomRuleWire Rule { get; init; }
}

[MessagePackObject]
public sealed class CssomSheetWire
{
    [Key("id")]
    public required string Id { get; init; }

    [Key("scope")]
    public required CssomScopeWire Scope { get; init; }

    [Key("rules")]
    public List<CssomRuleWire> Rules { get; init; } = [];
}

[MessagePackObject]
public sealed class CssomScopeWire
{
    [Key("kind")]
    public required string Kind { get; init; }

    [Key("hostAnchor")]
    public string? HostAnchor { get; init; }
}

[MessagePackObject]
public sealed class CssomRuleWire
{
    [Key("id")]
    public required string Id { get; init; }

    [Key("cssText")]
    public required string CssText { get; init; }
}
