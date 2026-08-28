namespace Speculum.Api.Scripts.Requests;

public sealed class ListScripts
{
    public const int DefaultTake = 50;
    public const int MaxTake = 200;

    public string Query { get; set; } = "";

    public int Skip { get; set; }

    public int Take { get; set; } = DefaultTake;
}
