using System.Diagnostics;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Hosting;

public sealed class TraefikReloader
{
    private readonly ILogger<TraefikReloader> _logger;
    private readonly string? _dockerSocket;

    public TraefikReloader(IConfiguration configuration, ILogger<TraefikReloader> logger)
    {
        _logger      = logger;
        _dockerSocket = configuration["Traefik:DockerSocket"]?.Trim();
    }

    public async Task ReloadAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_dockerSocket) || !File.Exists(_dockerSocket))
        {
            _logger.LogDebug("Docker socket not available — skipping Traefik reload signal.");
            return;
        }

        var containerId = await FindTraefikContainerIdAsync(ct);
        if (containerId is null)
        {
            _logger.LogWarning("Traefik container not found — reload skipped.");
            return;
        }

        foreach (var signal in new[] { "HUP", "USR1" })
        {
            try
            {
                await RunDockerKillAsync(containerId, signal, ct);
                _logger.LogInformation("Sent SIG{Signal} to Traefik container {Id}.", signal, containerId[..12]);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "SIG{Signal} to Traefik failed.", signal);
            }
        }
    }

    private async Task<string?> FindTraefikContainerIdAsync(CancellationToken ct)
    {
        foreach (var filter in new[] { "name=traefik", "ancestor=traefik:v3.6.1" })
        {
            var psi = new ProcessStartInfo
            {
                FileName               = "docker",
                ArgumentList           = { "ps", "--filter", filter, "--format", "{{.ID}}" },
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
            };

            using var proc = Process.Start(psi);
            if (proc is null) continue;
            var output = await proc.StandardOutput.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            if (proc.ExitCode != 0) continue;

            var id = output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                           .FirstOrDefault();
            if (!string.IsNullOrEmpty(id))
                return id;
        }

        return null;
    }

    private async Task RunDockerKillAsync(string containerId, string signal, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName               = "docker",
            ArgumentList           = { "kill", "-s", signal, containerId },
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
            UseShellExecute        = false,
        };

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start docker kill.");

        var err = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"docker kill failed: {err}");
    }
}
