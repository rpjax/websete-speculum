namespace Speculum.Api.Configurations.Persistence;

/// <summary>SQLite / HTTP section keys for engine configuration (exact PascalCase).</summary>
public static class ConfigSectionKeys
{
    public const string Hosting = "Hosting";
    public const string Navigation = "Navigation";
    public const string Sessions = "Sessions";
    public const string ResourceManagement = "ResourceManagement";
    public const string Journal = "Journal";
    public const string Telemetry = "Telemetry";

    public const string MetadataIsFirstBoot = "IsFirstBoot";

    public static readonly string[] AllEngineSections =
    [
        Hosting,
        Navigation,
        Sessions,
        ResourceManagement,
        Journal,
        Telemetry,
    ];

    /// <summary>Pre-PascalCase store keys (one-time rename on EnsureSchema).</summary>
    public static readonly (string Legacy, string Canonical)[] LegacyKeyMigrations =
    [
        ("hosting", Hosting),
        ("navigation", Navigation),
        ("sessions", Sessions),
        ("resourceManagement", ResourceManagement),
        ("journal", Journal),
        ("telemetry", Telemetry),
    ];
}
