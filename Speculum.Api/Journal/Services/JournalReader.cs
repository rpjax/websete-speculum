using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

public sealed class JournalReader : IJournalReader
{
    private readonly IJournalRepository _repository;
    private readonly IOptionsMonitor<JournalDrainOptions> _options;

    public JournalReader(
        IJournalRepository repository,
        IOptionsMonitor<JournalDrainOptions> options)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _options = options ?? throw new ArgumentNullException(nameof(options));
    }

    public Task<IReadOnlyList<JournalEntry>> ReadAsync(
        JournalQuery? query = null,
        CancellationToken cancellationToken = default)
    {
        query ??= new JournalQuery();
        ArgumentOutOfRangeException.ThrowIfNegative(query.Offset);

        var opts = _options.CurrentValue;
        var limit = query.Limit ?? opts.DefaultReadLimit;
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        if (limit > opts.MaxReadLimit)
        {
            throw new ArgumentOutOfRangeException(
                nameof(query),
                limit,
                $"JournalQuery.Limit cannot exceed MaxReadLimit ({opts.MaxReadLimit}).");
        }

        var normalized = new JournalQuery
        {
            Limit = limit,
            Offset = query.Offset,
            Filter = query.Filter,
            Orders = query.Orders,
        };

        return _repository.ReadAsync(normalized, cancellationToken);
    }
}
