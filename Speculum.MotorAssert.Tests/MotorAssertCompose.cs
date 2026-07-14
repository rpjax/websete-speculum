using System.Diagnostics;

namespace Speculum.MotorAssert.Tests;

/// <summary>docker compose helpers for sidecar kill/restart tests (A8/E6).</summary>
internal static class MotorAssertCompose
{
    public static void Run(string composeFile, params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "docker",
            ArgumentList = { "compose", "-f", composeFile },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args)
            psi.ArgumentList.Add(a);

        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEnd();
        var stderr = p.StandardError.ReadToEnd();
        p.WaitForExit(120_000);
        Assert.True(p.ExitCode == 0, $"docker compose {string.Join(' ', args)} failed: {stdout}\n{stderr}");
    }

    /// <summary>
    /// Wait until sidecar answers HTTP /health inside the container.
    /// API /ready alone is insufficient after <c>compose start sidecar</c>.
    /// </summary>
    public static async Task WaitSidecarHttpHealthyAsync(
        string composeFile,
        TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(120));
        Exception? last = null;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "docker",
                    ArgumentList =
                    {
                        "compose", "-f", composeFile, "exec", "-T", "sidecar",
                        "curl", "-sf", "http://localhost:3000/health",
                    },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                };
                using var p = Process.Start(psi)!;
                _ = await p.StandardOutput.ReadToEndAsync();
                _ = await p.StandardError.ReadToEndAsync();
                await p.WaitForExitAsync();
                if (p.ExitCode == 0)
                    return;
                last = new InvalidOperationException($"sidecar /health exit={p.ExitCode}");
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(1000);
        }

        Assert.Fail($"sidecar /health never became ready after restart. Last={last?.Message}");
    }
}
