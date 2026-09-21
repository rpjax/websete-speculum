using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Speculum.Supervisor.Browser;

/// <summary>
/// O processo do Gecko, do qual o supervisor é dono.
///
/// Doc 10: uma sessão é um par supervisor+browser. O par nasce junto e morre
/// junto. Quem sobe o browser é o supervisor — não existe browser avulso se
/// conectando a um supervisor que estava ali esperando.
/// </summary>
public sealed class BrowserProcess : IDisposable
{
    private readonly SupervisorOptions _options;
    private readonly ILogger _logger;
    private readonly string? _temporaryProfile;
    private Process? _process;

    public BrowserProcess(SupervisorOptions options, ILogger logger)
    {
        _options = options;
        _logger = logger;

        if (string.IsNullOrWhiteSpace(options.BrowserProfile))
        {
            _temporaryProfile = Path.Combine(
                Path.GetTempPath(),
                "speculum-profile-" + Guid.NewGuid().ToString("n")[..8]);
            Directory.CreateDirectory(_temporaryProfile);
        }
    }

    public bool HasExited => _process?.HasExited ?? true;

    /// <summary>Completa quando o processo do browser termina.</summary>
    public Task Exited { get; private set; } = Task.CompletedTask;

    public void Start()
    {
        if (!File.Exists(_options.BrowserExecutable))
        {
            throw new FileNotFoundException(
                $"executável do browser não encontrado: {_options.BrowserExecutable}",
                _options.BrowserExecutable);
        }

        var profile = _options.BrowserProfile ?? _temporaryProfile!;
        // Toda sessão: prefs de produto (uma aba / sem first-run). Lab overlays
        // (ex. webgl-normal) ficam no user.js do perfil; o bloco de produto é
        // reescrito no fim para não depender de path de lab.
        ProductProfilePrefs.EnsureInProfile(profile);

        var info = new ProcessStartInfo(_options.BrowserExecutable)
        {
            UseShellExecute = false,
        };

        if (_options.BrowserHeadless)
        {
            info.ArgumentList.Add("--headless");
        }

        info.ArgumentList.Add("-profile");
        info.ArgumentList.Add(profile);
        info.ArgumentList.Add("-no-remote");

        // Nada de URL na linha de comando. Quem abre contexto é o ContextCreate e
        // quem navega é o Navigate. Uma URL aqui vira um load de inicialização que
        // cai na MESMA aba projetada depois do ContextCreated e mata o primeiro
        // Navigate (medido: 2 em 5 execuções sem projetar nada).

        // O filho encontra o supervisor por aqui. Mesma variável que o sink em
        // ContentParent lê para escolher o destino do frame.
        info.Environment["SPECULUM_BROWSER_SOCKET"] = _options.BrowserSocketPath;
        // Lab: SPECULUM_ENABLE_CRASHREPORTER=1 grava minidump no perfil (139).
        if (string.Equals(
                Environment.GetEnvironmentVariable("SPECULUM_ENABLE_CRASHREPORTER"),
                "1",
                StringComparison.Ordinal))
        {
            info.Environment.Remove("MOZ_CRASHREPORTER_DISABLE");
            info.Environment["MOZ_CRASHREPORTER"] = "1";
            info.Environment["MOZ_CRASHREPORTER_NO_REPORT"] = "1";
        }
        else
        {
            info.Environment["MOZ_CRASHREPORTER_DISABLE"] = "1";
        }
        // Caps lidos uma vez no start do Firefox (SpeculumCaps). Launch params.
        info.Environment["SPECULUM_CAP_EVENTS"] = _options.CapEvents ? "1" : "0";
        info.Environment["SPECULUM_CAP_METRICS"] = _options.CapMetrics ? "1" : "0";

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        var exited = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        process.Exited += (_, _) =>
        {
            _logger.LogInformation("browser encerrou com código {Code}", SafeExitCode(process));
            exited.TrySetResult();
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("não foi possível iniciar o browser");
        }

        _process = process;
        Exited = exited.Task;

        _logger.LogInformation(
            "browser iniciado pid={Pid} perfil={Profile}",
            process.Id,
            profile);
    }

    /// <summary>
    /// Encerra o browser. Termina primeiro; mata se não sair.
    /// O par morre junto: se o supervisor está indo embora, o browser vai também.
    /// </summary>
    public void Stop()
    {
        var process = _process;
        if (process is null || process.HasExited)
        {
            return;
        }

        try
        {
            _logger.LogInformation("encerrando o browser pid={Pid}", process.Id);
            process.Kill(entireProcessTree: true);
            process.WaitForExit(5000);
        }
        catch (InvalidOperationException)
        {
            // já saiu entre o teste e o kill
        }
    }

    public void Dispose()
    {
        Stop();
        _process?.Dispose();

        if (_temporaryProfile is not null)
        {
            try
            {
                Directory.Delete(_temporaryProfile, recursive: true);
            }
            catch (IOException)
            {
                // perfil temporário órfão não é motivo para falhar o encerramento
            }
        }
    }

    private static string SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode.ToString();
        }
        catch (InvalidOperationException)
        {
            return "?";
        }
    }
}
