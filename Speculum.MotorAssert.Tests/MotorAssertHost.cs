using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

public sealed class MotorAssertHost
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public string ApiBase { get; }
    public string AdminKey { get; }
    public string FixtureClientOrigin { get; }
    public string EvilClientOrigin { get; }
    public HttpClient Http { get; }

    public MotorAssertHost()
    {
        ApiBase = (Environment.GetEnvironmentVariable("MOTOR_ASSERT_API_BASE") ?? "http://127.0.0.1:18080")
            .TrimEnd('/');
        AdminKey = Environment.GetEnvironmentVariable("MOTOR_ASSERT_ADMIN_KEY") ?? "motor-assert-admin-key";
        FixtureClientOrigin = Environment.GetEnvironmentVariable("MOTOR_ASSERT_CLIENT_ORIGIN")
            ?? "https://speculum.test";
        EvilClientOrigin = Environment.GetEnvironmentVariable("MOTOR_ASSERT_EVIL_ORIGIN")
            ?? "https://evil.example";

        Http = new HttpClient { BaseAddress = new Uri(ApiBase + "/"), Timeout = TimeSpan.FromSeconds(60) };
        Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AdminKey);
    }

    public async Task EnsureReadyAsync(CancellationToken ct = default)
    {
        for (var i = 0; i < 60; i++)
        {
            try
            {
                var ready = await Http.GetAsync("/ready", ct);
                if (ready.IsSuccessStatusCode)
                    return;
            }
            catch
            {
                // retry
            }

            await Task.Delay(1000, ct);
        }

        throw new InvalidOperationException("API /ready never became healthy. Did seed-motor-assert.sh run?");
    }

    public Task<HttpResponseMessage> PutConfigAsync(string section, object body, CancellationToken ct = default)
        => Http.PutAsJsonAsync($"api/admin/config/{section}", body, Json, ct);

    public Task<HttpResponseMessage> DeleteConfigAsync(string section, CancellationToken ct = default)
        => Http.DeleteAsync($"api/admin/config/{section}", ct);

    public async Task DumpFailureAsync(string? connectionId, DateTimeOffset? since, string dir)
    {
        Directory.CreateDirectory(dir);
        try
        {
            var runtime = await Http.GetStringAsync("api/admin/diagnostics/v1/runtime");
            await File.WriteAllTextAsync(Path.Combine(dir, "runtime.json"), runtime);
        }
        catch (Exception ex)
        {
            await File.WriteAllTextAsync(Path.Combine(dir, "runtime.error.txt"), ex.ToString());
        }

        try
        {
            var qs = new StringBuilder("api/admin/diagnostics/v1/events?");
            if (since is not null)
                qs.Append("since=").Append(Uri.EscapeDataString(since.Value.UtcDateTime.ToString("o"))).Append('&');
            if (!string.IsNullOrEmpty(connectionId))
                qs.Append("connectionId=").Append(Uri.EscapeDataString(connectionId));
            var events = await Http.GetStringAsync(qs.ToString().TrimEnd('&', '?'));
            await File.WriteAllTextAsync(Path.Combine(dir, "events.json"), events);
        }
        catch (Exception ex)
        {
            await File.WriteAllTextAsync(Path.Combine(dir, "events.error.txt"), ex.ToString());
        }

        try
        {
            var status = await Http.GetStringAsync("api/admin/config/status");
            await File.WriteAllTextAsync(Path.Combine(dir, "config-status.json"), status);
        }
        catch { /* best-effort */ }
    }
}
