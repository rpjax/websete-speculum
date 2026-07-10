namespace Websete.Speculum.Host.Config.Runtime;

public sealed class ForwardingOptions
{
    public string Host { get; init; } = "";
    public string[] Domains { get; init; } = [];
}
