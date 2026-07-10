namespace Websete.Speculum.Host.Config.Runtime;

public static class ConfigSectionKeys
{
    public const string Admin            = "Admin";
    public const string Forwarding       = "Forwarding";
    public const string MaxSessions      = "MaxSessions";
    public const string ScriptInjection  = "ScriptInjection";
    public const string JsBridge         = "JsBridge";

    public static readonly string[] All =
    [
        Admin,
        Forwarding,
        MaxSessions,
        ScriptInjection,
        JsBridge,
    ];

    public static readonly string[] RequiredForOperation =
    [
        Forwarding,
        MaxSessions,
    ];
}
