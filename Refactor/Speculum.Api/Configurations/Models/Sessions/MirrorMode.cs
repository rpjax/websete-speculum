namespace Speculum.Api.Configurations.Models.Sessions;

/// <summary>
/// Admin-only Sessions projection mode. Fixed at Launch from engine config;
/// projected to public client-config so the SPA mounts the correct surface before
/// StartSession. The session client does not choose the mode.
/// </summary>
public enum MirrorMode
{
    VideoStreaming = 0,
    PageProjection = 1,
}
