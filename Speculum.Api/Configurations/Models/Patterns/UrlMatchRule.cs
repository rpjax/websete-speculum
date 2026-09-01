namespace Speculum.Api.Configurations.Models.Patterns;

public sealed class UrlMatchRule
{
    public DomainPattern Domain { get; init; } = new();
    public PathPattern Path { get; init; } = new();
}
