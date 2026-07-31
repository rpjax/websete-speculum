using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionResizeCoalescerTests
{
    [Fact]
    public async Task Burst_CollapsesToSingleExecute_WithLatestSize()
    {
        var coalescer = new SessionResizeCoalescer(TimeSpan.FromMilliseconds(40));
        var executes = 0;
        var lastWidth = 0;

        async Task<Aidan.Core.Patterns.IResult<ResizeResult>> Execute(ResizeSession req, CancellationToken ct)
        {
            Interlocked.Increment(ref executes);
            lastWidth = req.Width;
            await Task.Delay(5, ct);
            return Aidan.Core.Patterns.Result<ResizeResult>.Success(new ResizeResult
            {
                Applied = true,
                Outcome = ResizeOutcome.Applied,
                Width = req.Width,
                Height = req.Height,
            });
        }

        var t1 = coalescer.SubmitAsync(new ResizeSession { Width = 100, Height = 100 }, Execute, CancellationToken.None);
        var t2 = coalescer.SubmitAsync(new ResizeSession { Width = 200, Height = 200 }, Execute, CancellationToken.None);
        var t3 = coalescer.SubmitAsync(new ResizeSession { Width = 300, Height = 300 }, Execute, CancellationToken.None);

        var results = await Task.WhenAll(t1, t2, t3);
        Assert.Equal(1, executes);
        Assert.Equal(300, lastWidth);
        Assert.All(results, r => Assert.True(r.IsSuccess && r.Value.Applied));
        Assert.All(results, r => Assert.Equal(300, r.Value.Width));
    }
}
