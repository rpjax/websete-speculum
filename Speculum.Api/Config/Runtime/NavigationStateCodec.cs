using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Speculum.Api.Config.Runtime;

public sealed class NavigationStateCodec
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly byte[] _key;
    private readonly bool _encrypt;

    public NavigationStateCodec(byte[] key, bool encrypt)
    {
        _key    = key;
        _encrypt = encrypt;
    }

    public string Encode(NavigationStateV1 state)
    {
        var json = JsonSerializer.Serialize(state, JsonOptions);
        var payload = _encrypt ? Encrypt(Encoding.UTF8.GetBytes(json)) : Encoding.UTF8.GetBytes(json);
        return Uri.EscapeDataString(Convert.ToBase64String(payload));
    }

    public NavigationStateV1? Decode(string? encoded)
    {
        if (string.IsNullOrWhiteSpace(encoded))
            return null;

        try
        {
            var raw = Uri.UnescapeDataString(encoded.Trim());
            var bytes = Convert.FromBase64String(raw);
            var jsonBytes = _encrypt ? Decrypt(bytes) : bytes;
            return JsonSerializer.Deserialize<NavigationStateV1>(jsonBytes, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private byte[] Encrypt(byte[] plaintext)
    {
        var nonce = new byte[12];
        RandomNumberGenerator.Fill(nonce);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, plaintext, ciphertext, tag);

        var result = new byte[nonce.Length + tag.Length + ciphertext.Length];
        Buffer.BlockCopy(nonce, 0, result, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, result, nonce.Length, tag.Length);
        Buffer.BlockCopy(ciphertext, 0, result, nonce.Length + tag.Length, ciphertext.Length);
        return result;
    }

    private byte[] Decrypt(byte[] payload)
    {
        if (payload.Length < 28)
            throw new CryptographicException("Invalid NSO payload.");

        var nonce = payload.AsSpan(0, 12);
        var tag = payload.AsSpan(12, 16);
        var ciphertext = payload.AsSpan(28);

        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(_key, 16);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);
        return plaintext;
    }
}
