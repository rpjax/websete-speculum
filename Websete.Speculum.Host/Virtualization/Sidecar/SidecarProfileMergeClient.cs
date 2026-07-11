using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Websete.Speculum.Host.Virtualization.Options;

namespace Websete.Speculum.Host.Virtualization.Sidecar;

public interface ISidecarProfileMergeClient
{
    Task<byte[]> MergeProfilesAsync(byte[] baseBlob, byte[] incomingBlob, CancellationToken ct = default);
}

public sealed class SidecarProfileMergeClient : ISidecarProfileMergeClient
{
    private readonly string _sidecarBaseUrl;

    public SidecarProfileMergeClient(SidecarBrowserClientOptions options)
    {
        _sidecarBaseUrl = options.SidecarBaseUrl;
    }

    public async Task<byte[]> MergeProfilesAsync(
        byte[] baseBlob,
        byte[] incomingBlob,
        CancellationToken ct = default)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));
        var token = timeoutCts.Token;

        using var ws = new ClientWebSocket();
        var uri = new Uri(_sidecarBaseUrl.TrimEnd('/'));
        await ws.ConnectAsync(uri, token);

        var request = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type         = "mergeProfiles",
            baseBlob     = Convert.ToBase64String(baseBlob),
            incomingBlob = Convert.ToBase64String(incomingBlob),
        });

        await ws.SendAsync(request, WebSocketMessageType.Text, true, token);

        using var stream = new MemoryStream();
        var buf    = ArrayPool<byte>.Shared.Rent(256 * 1024);
        var filled = 0;

        try
        {
            while (ws.State == WebSocketState.Open)
            {
                if (filled == buf.Length)
                {
                    var bigger = ArrayPool<byte>.Shared.Rent(buf.Length * 2);
                    Buffer.BlockCopy(buf, 0, bigger, 0, filled);
                    ArrayPool<byte>.Shared.Return(buf);
                    buf = bigger;
                }

                var result = await ws.ReceiveAsync(buf.AsMemory(filled), token);
                if (result.MessageType == WebSocketMessageType.Close)
                    break;

                filled += result.Count;
                if (!result.EndOfMessage)
                    continue;

                if (result.MessageType == WebSocketMessageType.Binary
                    && filled >= 2
                    && buf[0] == SidecarProtocol.MsgProfileChunk)
                {
                    stream.Write(buf, 1, filled - 1);
                }
                else if (result.MessageType == WebSocketMessageType.Text)
                {
                    var text = Encoding.UTF8.GetString(buf, 0, filled);
                    using var doc = JsonDocument.Parse(text);
                    var type = doc.RootElement.GetProperty("type").GetString();

                    if (type == "mergeDone")
                    {
                        var expected = doc.RootElement.GetProperty("byteSize").GetInt32();
                        var blob     = stream.ToArray();
                        if (blob.Length != expected)
                            throw new InvalidOperationException(
                                $"Profile merge size mismatch: expected {expected}, got {blob.Length}.");
                        return blob;
                    }

                    if (type is "mergeError" or "error")
                    {
                        var msg = doc.RootElement.TryGetProperty("message", out var m)
                            ? m.GetString() ?? "merge failed"
                            : "merge failed";
                        throw new InvalidOperationException(msg);
                    }
                }

                filled = 0;
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buf);
        }

        throw new InvalidOperationException("Sidecar closed before profile merge completed.");
    }
}
