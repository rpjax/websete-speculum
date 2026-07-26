namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class ClientEnvironmentPolicy
{
    public string DefaultLocale { get; init; } = "";
    public string DefaultLanguage { get; init; } = "";
    public string DefaultTimeZoneId { get; init; } = "";
    public string DefaultColorScheme { get; init; } = "";

    public static bool IsSupportedColorScheme(string? value)
        => value is not null
            && (value.Equals("light", StringComparison.OrdinalIgnoreCase)
                || value.Equals("dark", StringComparison.OrdinalIgnoreCase)
                || value.Equals("no-preference", StringComparison.OrdinalIgnoreCase));
}
