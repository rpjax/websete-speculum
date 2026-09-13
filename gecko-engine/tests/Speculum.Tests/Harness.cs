namespace Speculum.Tests;

/// <summary>
/// Cola de lançamento para os degraus que sobem processos (L3, L4).
///
/// Tudo roda pelo muxer (`dotnet X.dll`), nunca pelo apphost: o muxer resolve o
/// runtime a partir do próprio lugar, então não importa se o .NET está instalado
/// num diretório privado (ex.: /root/.dotnet) em vez de um local de sistema. O
/// run.sh passa os caminhos por ambiente.
/// </summary>
public static class Harness
{
    public static bool TryDotnet(out string dotnet, out string problem)
    {
        var value = Environment.GetEnvironmentVariable("SPECULUM_DOTNET");
        if (string.IsNullOrWhiteSpace(value) || !File.Exists(value))
        {
            dotnet = "";
            problem = value is null ? "SPECULUM_DOTNET não definida" : $"não existe: {value}";
            return false;
        }

        dotnet = value;
        problem = "";
        return true;
    }

    public static bool TryDll(string envName, out string dll, out string problem)
    {
        var value = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrWhiteSpace(value) || !File.Exists(value))
        {
            dll = "";
            problem = value is null ? $"{envName} não definida" : $"não existe: {value}";
            return false;
        }

        dll = value;
        problem = "";
        return true;
    }

    /// <summary>
    /// O supervisor lança o SPECULUM_BROWSER_BIN como executável ÚNICO, com
    /// argumentos de firefox. Para o browser falso ser esse executável sem
    /// depender de apphost, escrevemos um wrapper que chama o muxer + a dll de
    /// teste. Os argumentos de firefox são ignorados (o papel vem do ambiente,
    /// SPECULUM_TESTS_ROLE), então o wrapper só repassa "$@" por higiene.
    /// </summary>
    public static string WriteFakeBrowserWrapper(string dotnet, string testsDll)
    {
        var path = Path.Combine(Path.GetTempPath(), $"spec-fake-browser-{Guid.NewGuid():n}.sh");
        File.WriteAllText(path, $"#!/bin/sh\nexec \"{dotnet}\" \"{testsDll}\" \"$@\"\n");

        // O wrapper só faz sentido no Linux (é onde a escada roda). O guard
        // satisfaz o CA1416 e mantém aviso-é-erro sem exceção pontual.
        if (OperatingSystem.IsLinux())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
                | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }

        return path;
    }
}
