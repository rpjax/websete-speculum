using MessagePack;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// PageProjection outbound unit — Dom or Cssom plane (exclusive payload per operation).
/// </summary>
[MessagePackObject]
public sealed class PageProjectionDiff
{
    [Key("sequence")]
    public long Sequence { get; init; }

    [Key("generation")]
    public long Generation { get; init; }

    [Key("timestamp")]
    public long Timestamp { get; init; }

    /// <summary>dom | cssom</summary>
    [Key("plane")]
    public required string Plane { get; init; }

    /// <summary>
    /// Dom: document | childList | patch | scrollViewport | scrollElement.
    /// Cssom: install | sheetList | ruleList | patch.
    /// </summary>
    [Key("operation")]
    public required string Operation { get; init; }

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
