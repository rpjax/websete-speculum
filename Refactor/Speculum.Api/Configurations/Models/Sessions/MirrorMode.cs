namespace Speculum.Api.Configurations.Models.Sessions;

/// <summary>
/// Admin-only Sessions projection mode. Fixed at Launch from engine config;
/// not chosen by StartSession or public client-config.
/// </summary>
public enum MirrorMode
{
    VideoStreaming = 0,
    DomProjection = 1,
}
