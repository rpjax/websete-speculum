namespace Speculum.Api.Journal.Storage;

/// <summary>
/// Column length ceilings mirrored from EF attributes — enforced at admission.
/// </summary>
internal static class JournalStoreLimits
{
    public const int MaxTypeLength = 256;
    public const int MaxIndexTypeLength = 128;
    public const int MaxIndexValueLength = 512;
}
