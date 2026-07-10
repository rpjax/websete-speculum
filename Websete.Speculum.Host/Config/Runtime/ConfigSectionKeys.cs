namespace Websete.Speculum.Host.Config.Runtime;

public static class ConfigSectionKeys
{
    public const string Forwarding       = "Forwarding";
    public const string MaxSessions      = "MaxSessions";
    public const string Environment      = "Environment";
    public const string ScriptInjection  = "ScriptInjection";
    public const string JsBridge         = "JsBridge";

    public static readonly string[] All =
    [
        Forwarding,
        MaxSessions,
        Environment,
        ScriptInjection,
        JsBridge,
    ];

    public static readonly string[] RequiredForOperation =
    [
        Forwarding,
        MaxSessions,
        Environment,
    ];
}
