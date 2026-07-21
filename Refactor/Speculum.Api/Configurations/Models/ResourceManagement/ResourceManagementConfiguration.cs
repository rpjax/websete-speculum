namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class ResourceManagementConfiguration
{
    public const string SectionName = "ResourceManagement";

    public SessionResourceConfiguration Sessions { get; init; } = new();
    public ProfileResourceConfiguration Profiles { get; init; } = new();
    public DiagnosticsResourceConfiguration Diagnostics { get; init; } = new();
}
