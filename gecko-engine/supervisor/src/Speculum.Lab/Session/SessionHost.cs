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

    public bool Running => _supervisor is { HasExited: false };

    /// <summary>
    /// Garante uma sessão viva navegando para <paramref name="url"/>.
    /// Sessão anterior é encerrada — uma sessão por lab.
    /// </summary>
    public async Task StartAsync(string url, CancellationToken cancellationToken)
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
            info.Environment["SPECULUM_BROWSER_URL"] = url;
            info.Environment["SPECULUM_SUPERVISOR_PORT"] = options.SupervisorUri.Port.ToString();

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.Exited += (_, _) => logger.LogInformation("supervisor encerrou");

            if (!process.Start())
            {
                logger.LogError("não foi possível iniciar o supervisor");
                return;
            }

            _supervisor = process;
            logger.LogInformation("sessão iniciada — supervisor pid={Pid} url={Url}", process.Id, url);
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
        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                // O supervisor mata o browser ao sair (doc 17 §1): o par morre junto.
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
