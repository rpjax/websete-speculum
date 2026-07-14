using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Tests;

public sealed class AdminScriptUploadTests : IClassFixture<SpeculumWebApplicationFactory>
{
    private readonly HttpClient _client;
    private readonly SpeculumWebApplicationFactory _factory;

    public AdminScriptUploadTests(SpeculumWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Upload_rejects_over_5mb()
    {
        await AuthenticateAsync();
        var big = new byte[5 * 1024 * 1024 + 1024];
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(big), "file", "too-big.js");
        var res = await _client.PostAsync("/api/admin/scripts", content);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var text = await res.Content.ReadAsStringAsync();
        Assert.Contains("5 MB", text, StringComparison.OrdinalIgnoreCase);
    }

    private async Task AuthenticateAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<ISpeculumConfigStore>();
        var key = store.Current.AdminApiKey;
        Assert.False(string.IsNullOrWhiteSpace(key));
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        await Task.CompletedTask;
    }
}
