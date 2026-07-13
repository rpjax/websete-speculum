using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;

namespace Speculum.Api.BrowserPersistence;

internal sealed class BrowserSessionDatabase
{
    public const int DefaultTtlDays = 30;
    public const string ClientTokenIndexer = "client_token";

    public string DatabasePath { get; }

    public BrowserSessionDatabase(string databasePath) => DatabasePath = databasePath;

    public SpeculumDbContext CreateContext() => new(DatabasePath);

    public static void AddParam(System.Data.Common.DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value         = value;
        cmd.Parameters.Add(p);
    }
}
