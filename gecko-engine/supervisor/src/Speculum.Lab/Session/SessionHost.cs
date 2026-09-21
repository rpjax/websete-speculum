using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Speculum.Lab.Session;

/// <summary>
/// Sobe e derruba a sessão: um processo de supervisor, que por sua vez é dono do
/// browser (doc 17 §1).
///
/// O caller é quem sobe o supervisor. Neste laço o caller é o lab — até o
/// orquestrador (doc 10) existir, é ele que ocupa esse papel. Não há script
/// intermediário: pedir sessão e ter sessão são o mesmo ato.
/// </summary>
public sealed class SessionHost(LabOptions options, ILogger<SessionHost> logger) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Process? _supervisor;
    private SessionLaunchParams? _lastLaunch;

    public bool Running => _supervisor is { HasExited: false };

    public SessionLaunchParams? LastLaunch => _lastLaunch;

    /// <summary>
    /// Garante uma sessão viva com os launch params. Sessão anterior é encerrada.
    /// </summary>
    public async Task StartAsync(SessionLaunchParams launch, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            StopLocked();

            if (!File.Exists(options.SupervisorExecutable))
            {
                logger.LogError(
                    "supervisor não encontrado em {Path}. Publique-o ou defina SPECULUM_SUPERVISOR_BIN.",
                    options.SupervisorExecutable);
                return;
            }

            var info = new ProcessStartInfo(options.SupervisorExecutable)
            {
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(options.SupervisorExecutable),
            };
            info.Environment["SPECULUM_BROWSER_BIN"] = options.BrowserExecutable;
            info.Environment["SPECULUM_BROWSER_URL"] = launch.Url;
            info.Environment["SPECULUM_SUPERVISOR_PORT"] = options.SupervisorUri.Port.ToString();
            info.Environment["SPECULUM_CAP_EVENTS"] = launch.CapEvents ? "1" : "0";
            info.Environment["SPECULUM_CAP_METRICS"] = launch.CapMetrics ? "1" : "0";
            // Lab default: janela visível (Virtual observável). Headless = export 1.
            info.Environment["SPECULUM_BROWSER_HEADLESS"] =
                Environment.GetEnvironmentVariable("SPECULUM_BROWSER_HEADLESS") ?? "0";
            var browserProfile = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_PROFILE");
            if (!string.IsNullOrWhiteSpace(browserProfile))
            {
                info.Environment["SPECULUM_BROWSER_PROFILE"] = browserProfile;
            }
            // Oráculo frio: MOZ_LOG=Speculum:5 no ambiente do lab → Firefox via supervisor.
            var mozLog = Environment.GetEnvironmentVariable("MOZ_LOG");
            if (!string.IsNullOrWhiteSpace(mozLog))
            {
                info.Environment["MOZ_LOG"] = mozLog;
            }

            var mozLogFile = Environment.GetEnvironmentVariable("MOZ_LOG_FILE");
            if (!string.IsNullOrWhiteSpace(mozLogFile))
            {
                info.Environment["MOZ_LOG_FILE"] = mozLogFile;
            }
            if (launch.ViewportWidth > 0)
            {
                info.Environment["SPECULUM_VIEWPORT_WIDTH"] = launch.ViewportWidth.ToString();
            }

            if (launch.ViewportHeight > 0)
            {
                info.Environment["SPECULUM_VIEWPORT_HEIGHT"] = launch.ViewportHeight.ToString();
            }

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.Exited += (_, _) => logger.LogInformation("supervisor encerrou");

            if (!process.Start())
            {
                logger.LogError("não foi possível iniciar o supervisor");
                return;
            }

            _supervisor = process;
            _lastLaunch = launch;
            logger.LogInformation(
                "sessão iniciada — supervisor pid={Pid} url={Url} caps.events={Events} caps.metrics={Metrics}",
                process.Id,
                launch.Url,
                launch.CapEvents,
                launch.CapMetrics);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Stop()
    {
        _gate.Wait();
        try
        {
            StopLocked();
        }
        finally
        {
            _gate.Release();
        }
    }

    private void StopLocked()
    {
        var process = _supervisor;
        _supervisor = null;
        _lastLaunch = null;
        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                logger.LogInformation("encerrando sessão — supervisor pid={Pid}", process.Id);
                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
        }
        catch (InvalidOperationException)
        {
            // já saiu
        }
        finally
        {
            process.Dispose();
        }
    }

    public void Dispose()
    {
        Stop();
        _gate.Dispose();
    }
}
