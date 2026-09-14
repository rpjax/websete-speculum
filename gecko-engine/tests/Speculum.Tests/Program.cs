using Speculum.Tests;

// Papel de browser falso: escolhido pelo ambiente, não pela linha de comando —
// porque quem lança este binário como browser é o supervisor, e o supervisor
// dita os argumentos (--headless -profile … about:blank). A variável é do arnês
// de teste; nenhum caminho de produção a lê. Ver FakeBrowser.
if (Environment.GetEnvironmentVariable("SPECULUM_TESTS_ROLE") == "fake-browser")
{
    return await FakeBrowser.RunAsync();
}

// Runner da escada. Sem framework: a saída É o veredito (doc 19 §1).
var layer = args.Length > 0 ? args[0].ToLowerInvariant() : "all";
var golden = ResolveGolden();

var code = layer switch
{
    "l1" => AbiTests.Run(golden),
    "l2" => await TransportTests.RunAsync(),
    "l3" => await RunL3Async(),
    "l4" => await StackTests.RunAsync(),
    "all" => await RunAllAsync(golden),
    _ => Unknown(layer),
};

return code;

static async Task<int> RunAllAsync(string golden)
{
    // Do mais barato ao mais caro. Cada degrau é independente; somamos os códigos
    // para que "all" só passe se todos passarem, e o relato de cada um apareça.
    var l1 = AbiTests.Run(golden);
    Console.WriteLine();
    var l2 = await TransportTests.RunAsync();
    Console.WriteLine();
    var l3 = await WiringTests.RunAsync();
    Console.WriteLine();
    var extra = await ExtraLayerTests.RunAsync();

    Console.WriteLine();
    var total = l1 + l2 + l3 + extra;
    Console.WriteLine(total == 0
        ? "ESCADA (sem Gecko): L1+L2+L3 OK"
        : "ESCADA (sem Gecko): FALHOU — ver degraus acima");
    return total == 0 ? 0 : 1;
}

static async Task<int> RunL3Async()
{
    var wiring = await WiringTests.RunAsync();
    Console.WriteLine();
    var extra = await ExtraLayerTests.RunAsync();
    return wiring + extra == 0 ? 0 : 1;
}

static int Unknown(string layer)
{
    Console.Error.WriteLine($"degrau desconhecido: '{layer}'. Use l1, l2, l3, l4 ou all.");
    return 2;
}

// O golden viaja para o diretório de saída (ver csproj). Fora daí, cai para a
// variável de ambiente e depois para a busca na árvore do repositório.
static string ResolveGolden()
{
    var beside = Path.Combine(AppContext.BaseDirectory, "control-abi.golden");
    if (File.Exists(beside))
    {
        return beside;
    }

    var fromEnv = Environment.GetEnvironmentVariable("SPECULUM_GOLDEN");
    if (!string.IsNullOrWhiteSpace(fromEnv) && File.Exists(fromEnv))
    {
        return fromEnv;
    }

    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
        var candidate = Path.Combine(dir.FullName, "gecko-engine", "tests", "control-abi.golden");
        if (File.Exists(candidate))
        {
            return candidate;
        }

        dir = dir.Parent;
    }

    return beside; // não existe; o AbiTests reporta com o caminho tentado
}
