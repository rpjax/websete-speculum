using System.Net;
using System.Text;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

[Collection(nameof(MotorAssertCollection))]
[Trait("Category", "MotorAssertive")]
public sealed class ScriptsDeepTests(MotorAssertFixture fx)
{
    [MotorAssertFact]
    public async Task H3_header_top_classic_sets_marker()
    {
        await RunInjectionAsync(
            "window.__SPECULUM_HEADER_TOP__ = 'ht-classic';",
            "ht-classic.js",
            position: "HeaderTop",
            type: "Classic",
            evaluate: "window.__SPECULUM_HEADER_TOP__",
            expected: "ht-classic");
    }

    [MotorAssertFact]
    public async Task H4_body_bottom_module_sets_marker()
    {
        await RunInjectionAsync(
            "window.__SPECULUM_BODY_MODULE__ = 'bb-module';",
            "bb-module.js",
            position: "BodyBottom",
            type: "Module",
            evaluate: "window.__SPECULUM_BODY_MODULE__",
            expected: "bb-module");
    }

    [MotorAssertFact]
    public async Task H6_missing_script_id_rejected()
    {
        var put = await fx.Host.PutConfigAsync("ScriptInjection", new[]
        {
            new { scriptId = "does-not-exist-zzzz", position = "BodyBottom", type = "Classic" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [MotorAssertFact]
    public async Task H7_script_delete_removes_upload()
    {
        var scriptBody = "window.__noop_h7 = 1;";
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(scriptBody)), "file", "h7.js");
        var upload = await fx.Host.Http.PostAsync("api/admin/scripts", content);
        upload.EnsureSuccessStatusCode();
        using var uploaded = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var scriptId = uploaded.RootElement.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(scriptId));

        var del = await fx.Host.Http.DeleteAsync($"api/admin/scripts/{scriptId}");
        del.EnsureSuccessStatusCode();

        var put = await fx.Host.PutConfigAsync("ScriptInjection", new[]
        {
            new { scriptId, position = "BodyBottom", type = "Classic" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [MotorAssertFact]
    public async Task H8_script_upload_size_limit()
    {
        // Softly over 5 MB.
        var big = new byte[5 * 1024 * 1024 + 2048];
        Random.Shared.NextBytes(big);
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(big), "file", "too-big.js");
        var upload = await fx.Host.Http.PostAsync("api/admin/scripts", content);
        Assert.Equal(HttpStatusCode.BadRequest, upload.StatusCode);
        var text = await upload.Content.ReadAsStringAsync();
        Assert.Contains("5 MB", text, StringComparison.OrdinalIgnoreCase);
    }

    private async Task RunInjectionAsync(
        string scriptBody,
        string fileName,
        string position,
        string type,
        string evaluate,
        string expected)
    {
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(scriptBody)), "file", fileName);
        var upload = await fx.Host.Http.PostAsync("api/admin/scripts", content);
        upload.EnsureSuccessStatusCode();
        using var uploaded = JsonDocument.Parse(await upload.Content.ReadAsStringAsync());
        var scriptId = uploaded.RootElement.GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(scriptId));

        var putInj = await fx.Host.PutConfigAsync("ScriptInjection", new[]
        {
            new { scriptId, position, type },
        });
        putInj.EnsureSuccessStatusCode();

        try
        {
            var since = DateTimeOffset.UtcNow.AddSeconds(-2);
            var actId = Guid.NewGuid().ToString("N");
            await using var act = new MotorActClient(fx.Host);
            await act.ConnectAsync();
            await act.StartSessionAsync($"{fx.Host.FixtureClientOrigin}/inject-probe", actId);
            await fx.Diagnostics.WaitForEventsAsync(
                act.ConnectionId, "Motor.Session", since,
                ev => DiagnosticsAssertClient.HasEvent(ev, "Motor.SessionStarted", actId));

            await fx.Diagnostics.ExpectEvaluateAsync(act.ConnectionId!, evaluate, expected);
        }
        finally
        {
            await fx.Host.PutConfigAsync("ScriptInjection", Array.Empty<object>());
            await fx.Host.Http.DeleteAsync($"api/admin/scripts/{scriptId}");
        }
    }
}
