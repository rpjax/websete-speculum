namespace Websete.Speculum.Host.Virtualization;

internal static class ViewportDimensions
{
    public static (int Width, int Height) Normalize(int viewportWidth, int viewportHeight) =>
        (viewportWidth > 0 ? viewportWidth : 1280, viewportHeight > 0 ? viewportHeight : 720);
}
