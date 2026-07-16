using System.Diagnostics;
using System.Net.Sockets;
using System.Text.Json;

namespace Speculum.Api.Edge;

public sealed class TraefikReloader
{
    private readonly ILogger<TraefikReloader> _logger;
    private readonly string? _dockerSocket;

    public TraefikReloader(IConfiguration configuration, ILogger<TraefikReloader> logger)
    {
        _logger       = logger;
        _dockerSocket = configuration["Traefik:DockerSocket"]?.Trim();
    }

    public async Task ReloadAsync(bool restartForStaticConfig = false, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_dockerSocket) || !File.Exists(_dockerSocket))
        {
            _logger.LogDebug("Docker socket not available — skipping Traefik reload signal.");
            return;
        }

        var containerId = await FindTraefikContainerIdAsync(ct);
        if (containerId is null)
        {
            _logger.LogDebug("Traefik container not found — reload skipped (may not have started yet).");
            return;
        }

        if (restartForStaticConfig)
        {
            await RestartContainerAsync(containerId, ct);
            _logger.LogInformation(
                "Restarted Traefik container {Id} to apply static ACME configuration.",
                containerId[..Math.Min(12, containerId.Length)]);
            return;
        }

        foreach (var signal in new[] { "HUP", "USR1" })
        {
            try
            {
                await KillContainerAsync(containerId, signal, ct);
                _logger.LogInformation(
                    "Sent SIG{Signal} to Traefik container {Id}.",
                    signal,
                    containerId[..Math.Min(12, containerId.Length)]);
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
        // Prefer Docker Engine API over unix socket — the API image has no docker CLI.
        try
        {
            using var client = CreateDockerClient();
            var filters = Uri.EscapeDataString("""{"name":["traefik"]}""");
            using var response = await client.GetAsync($"/containers/json?filters={filters}", ct);
            if (response.IsSuccessStatusCode)
            {
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    if (item.TryGetProperty("Id", out var idEl))
                    {
                        var id = idEl.GetString();
                        if (!string.IsNullOrWhiteSpace(id))
                            return id;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Docker Engine API lookup for Traefik failed; trying docker CLI.");
        }

        return await FindTraefikContainerIdViaCliAsync(ct);
    }

    private async Task<string?> FindTraefikContainerIdViaCliAsync(CancellationToken ct)
    {
        foreach (var filter in new[] { "name=traefik", "ancestor=traefik:v3.6.1" })
        {
            try
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
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "docker CLI Traefik lookup failed.");
                return null;
            }
        }

        return null;
    }

    private async Task KillContainerAsync(string containerId, string signal, CancellationToken ct)
    {
        using var client = CreateDockerClient();
        using var response = await client.PostAsync(
            $"/containers/{containerId}/kill?signal={Uri.EscapeDataString(signal)}",
            content: null,
            ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"docker kill failed: {(int)response.StatusCode} {body}");
        }
    }

    private async Task RestartContainerAsync(string containerId, CancellationToken ct)
    {
        using var client = CreateDockerClient();
        using var response = await client.PostAsync(
            $"/containers/{containerId}/restart?t=5",
            content: null,
            ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"docker restart failed: {(int)response.StatusCode} {body}");
        }
    }

    private HttpClient CreateDockerClient()
    {
        if (string.IsNullOrEmpty(_dockerSocket))
            throw new InvalidOperationException("Docker socket path is not configured.");

        var socketPath = _dockerSocket;
        var handler = new SocketsHttpHandler
        {
            ConnectCallback = async (context, ct) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath), ct);
                return new NetworkStream(socket, ownsSocket: true);
            },
        };

        return new HttpClient(handler)
        {
            BaseAddress = new Uri("http://localhost"),
            Timeout = TimeSpan.FromSeconds(30),
        };
    }
}
