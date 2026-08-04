namespace Speculum.Api.Configurations.Models.Sessions;

/// <summary>
/// Screencast encode policy — CSS→JPEG scale for Retina sharpness, capped by Xvfb max.
/// </summary>
public sealed class ScreencastPolicy
{
    /// <summary>
    /// Max CSS→encode scale. 1 = CSS-only; 2 = up to Retina.
    /// Effective scale = min(MaxEncodeScale, clientDpr, displayW/cssW, displayH/cssH).
    /// </summary>
    public double MaxEncodeScale { get; init; } = 2;
}
