namespace Speculum.Api.Config.Runtime;

public static class ConfigSectionKeys
{
    public const string Admin               = "Admin";
    public const string Forwarding          = "Forwarding";
    public const string MaxSessions         = "MaxSessions";
    public const string ScriptInjection     = "ScriptInjection";
    public const string JsBridge            = "JsBridge";
    public const string SessionPolicy       = "SessionPolicy";
    public const string Hosting             = "Hosting";

    public static readonly string[] All =
    [
        Admin,
        Forwarding,
        MaxSessions,
        ScriptInjection,
        JsBridge,
        SessionPolicy,
        Hosting,
    ];

    public static readonly string[] RequiredForOperation =
    [
        Forwarding,
        MaxSessions,
    ];
}
