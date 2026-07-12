namespace Speculum.Api.Virtualization.Persistence;

public sealed class BrowserStatePayload
{
    public IReadOnlyList<BrowserCookieState> Cookies { get; init; } = [];
    public IReadOnlyList<BrowserLocalStorageState> LocalStorage { get; init; } = [];
    public IReadOnlyList<BrowserIdbRecordState> IdbRecords { get; init; } = [];
    public IReadOnlyList<BrowserHistoryState> History { get; init; } = [];
}

public sealed class BrowserCookieState
{
    public required string Name { get; init; }
    public required string Value { get; init; }
    public required string Domain { get; init; }
    public required string Path { get; init; }
    public double? Expires { get; init; }
    public bool HttpOnly { get; init; }
    public bool Secure { get; init; }
    public string? SameSite { get; init; }
}

public sealed class BrowserLocalStorageState
{
    public required string Origin { get; init; }
    public required string Key { get; init; }
    public required string Value { get; init; }
}

public sealed class BrowserIdbRecordState
{
    public required string Origin { get; init; }
    public required string DatabaseName { get; init; }
    public required string StoreName { get; init; }
    public required string KeyJson { get; init; }
    public required string ValueJson { get; init; }
}

public sealed class BrowserHistoryState
{
    public required string Url { get; init; }
    public string Title { get; init; } = "";
    public long VisitedAtMs { get; init; }
    public string TransitionType { get; init; } = "";
    public int IndexOrder { get; init; }
}

public class BrowserSessionMetadata
{
    public required string SessionId { get; init; }
    public required string ClientToken { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }
    public int CookieCount { get; init; }
    public int LocalStorageCount { get; init; }
    public int IdbRecordCount { get; init; }
    public int HistoryCount { get; init; }
}

public sealed class BrowserSessionDetail : BrowserSessionMetadata
{
    public IReadOnlyList<BrowserCookieState> Cookies { get; init; } = [];
    public IReadOnlyList<BrowserLocalStorageState> LocalStorage { get; init; } = [];
    public IReadOnlyList<BrowserIdbRecordState> IdbRecords { get; init; } = [];
    public IReadOnlyList<BrowserHistoryState> History { get; init; } = [];
}
