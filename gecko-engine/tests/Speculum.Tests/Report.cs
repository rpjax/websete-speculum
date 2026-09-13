using System.Text;

namespace Speculum.Tests;

/// <summary>
/// Relato de um degrau da escada.
///
/// Regra do doc 19: quem lê a saída conserta, não investiga. Toda falha carrega
/// o que era esperado, o que chegou, e os bytes crus quando houver bytes.
/// </summary>
public sealed class Report(string layer)
{
    private readonly List<string> _failures = [];
    private int _checks;

    public bool Failed => _failures.Count > 0;

    public void Pass(string what)
    {
        _checks++;
        Console.WriteLine($"  ok   {what}");
    }

    public void Fail(string what, string expected, string actual, string? extra = null)
    {
        _checks++;
        var sb = new StringBuilder();
        sb.AppendLine($"  FALHOU {what}");
        sb.AppendLine($"    esperado: {expected}");
        sb.AppendLine($"    recebido: {actual}");
        if (extra is { Length: > 0 })
        {
            foreach (var line in extra.Split('\n'))
            {
                sb.AppendLine($"    {line}");
            }
        }

        var text = sb.ToString().TrimEnd();
        _failures.Add(text);
        Console.WriteLine(text);
    }

    /// <summary>Compara byte a byte e aponta a primeira divergência com contexto.</summary>
    public void Bytes(string what, ReadOnlySpan<byte> expected, ReadOnlySpan<byte> actual)
    {
        if (expected.SequenceEqual(actual))
        {
            Pass($"{what} ({expected.Length} bytes)");
            return;
        }

        var limit = Math.Min(expected.Length, actual.Length);
        var at = -1;
        for (var i = 0; i < limit; i++)
        {
            if (expected[i] != actual[i])
            {
                at = i;
                break;
            }
        }

        var detail = at >= 0
            ? $"primeira divergência no byte {at}: esperado 0x{expected[at]:x2}, recebido 0x{actual[at]:x2}"
            : $"tamanhos diferentes: esperado {expected.Length}, recebido {actual.Length}";

        Fail(what, Hex(expected), Hex(actual), detail);
    }

    public void Equal<T>(string what, T expected, T actual)
    {
        if (EqualityComparer<T>.Default.Equals(expected, actual))
        {
            Pass($"{what} = {actual}");
            return;
        }

        Fail(what, $"{expected}", $"{actual}");
    }

    public int Finish()
    {
        Console.WriteLine();
        if (_failures.Count == 0)
        {
            Console.WriteLine($"{layer}: {_checks}/{_checks} OK");
            return 0;
        }

        Console.WriteLine($"{layer}: {_failures.Count} de {_checks} FALHARAM");
        return 1;
    }

    public static string Hex(ReadOnlySpan<byte> bytes)
    {
        var sb = new StringBuilder(bytes.Length * 3);
        foreach (var b in bytes)
        {
            sb.Append(b.ToString("x2")).Append(' ');
        }

        return sb.ToString().TrimEnd();
    }

    public static byte[] ParseHex(string text)
    {
        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var bytes = new byte[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            bytes[i] = Convert.ToByte(parts[i], 16);
        }

        return bytes;
    }
}
