using System.Runtime.InteropServices;

namespace Speculum.Supervisor;

/// <summary>
/// Doc 15: o supervisor é filho do orquestrador. Se o pai morre, o kernel mata
/// o filho — zero linha de limpeza no crash.
/// </summary>
internal static partial class ProcessDeath
{
    private const int PrSetPdeathsig = 1;
    private const int SigKill = 9;

    public static void BindToParent()
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        if (Prctl(PrSetPdeathsig, SigKill, 0, 0, 0) != 0)
        {
            throw new InvalidOperationException("PR_SET_PDEATHSIG recusado pelo kernel");
        }

        // Corrida: o pai morreu entre o fork e o prctl. getppid==1 = já órfão.
        if (GetPpid() == 1)
        {
            Environment.Exit(128 + SigKill);
        }
    }

    [LibraryImport("libc", EntryPoint = "prctl", SetLastError = true)]
    private static partial int Prctl(int option, int arg2, int arg3, int arg4, int arg5);

    [LibraryImport("libc", EntryPoint = "getppid")]
    private static partial int GetPpid();
}
