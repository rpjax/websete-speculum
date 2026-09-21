using Speculum.Api.Presentation.Auth;

namespace Speculum.Api.Sessions.Tests;

public sealed class ApiAuthMiddlewareTests
{
    [Fact]
    public void PageProjectionResync_IsSessionBindingNotOperatorBearer()
    {
        const string path = "/api/sessions/2c16824f-2191-40c3-a13e-89f8f1cd152c/page-projection/resync";
        Assert.True(ApiAuthMiddleware.IsVirtualAssetPath(path));
        Assert.True(ApiAuthMiddleware.IsPublicPath(path));
    }

    [Fact]
    public void DomUploads_StaySessionBinding()
    {
        const string path = "/api/sessions/2c16824f-2191-40c3-a13e-89f8f1cd152c/dom-uploads";
        Assert.True(ApiAuthMiddleware.IsVirtualAssetPath(path));
        Assert.True(ApiAuthMiddleware.IsPublicPath(path));
    }

    [Fact]
    public void SessionControlPlane_StillRequiresOperatorBearer()
    {
        const string path = "/api/sessions/2c16824f-2191-40c3-a13e-89f8f1cd152c";
        Assert.False(ApiAuthMiddleware.IsVirtualAssetPath(path));
        Assert.False(ApiAuthMiddleware.IsPublicPath(path));
    }

    [Fact]
    public void HarnessPageProjectionWait_StillRequiresOperatorBearer()
    {
        const string path = "/api/sessions/2c16824f-2191-40c3-a13e-89f8f1cd152c/page-projection/wait-frame";
        Assert.False(ApiAuthMiddleware.IsVirtualAssetPath(path));
        Assert.False(ApiAuthMiddleware.IsPublicPath(path));
    }
}
