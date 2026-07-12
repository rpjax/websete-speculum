namespace Speculum.Api.Config.Runtime;

public static class NavigationStateParam
{
    public const string Name = "_w7s_nso";
}

public sealed class NavigationStateV1
{
    public int V { get; init; } = 1;
    public string H { get; init; } = "";
}
