using System.Text.Json;
using Speculum.Api.Sessions.Models;
using Speculum.Supervisor.Control;

namespace Speculum.Api.BrowserClients.Gecko;

/// <summary>PageProjectionIntent → ABI Input/HistoryGo. O mesmo encoder do lab TypeScript.</summary>
internal static class GeckoIntentEncoder
{
    public static byte[]? Encode(uint correlation, PageProjectionIntent intent)
    {
        var type = intent.Type.Trim();
        var ctx = intent.ContextId > 0 ? intent.ContextId : 1u;
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(intent.Payload) ? "{}" : intent.Payload);
        var root = doc.RootElement;

        if (type is "down" or "up")
        {
            var nodeId = intent.TargetId ?? 0;
            return ControlCommand.InputPointer(
                correlation,
                ctx,
                type == "down" ? ControlCommand.InputDown : ControlCommand.InputUp,
                nodeId,
                FracU16(ReadDouble(root, "localX")),
                FracU16(ReadDouble(root, "localY")),
                ButtonU8(ReadString(root, "button")));
        }

        if (type is "keyDown" or "keyUp" or "keydown" or "keyup")
        {
            var down = type is "keyDown" or "keydown";
            return ControlCommand.InputKey(
                correlation,
                ctx,
                down ? ControlCommand.InputKeyDown : ControlCommand.InputKeyUp,
                ReadString(root, "key") ?? "",
                ReadString(root, "code") ?? "",
                ModsU8(root));
        }

        if (type is "scrollSet")
        {
            return ControlCommand.InputScroll(
                correlation,
                ctx,
                intent.TargetId ?? 0,
                FracU16(ReadDouble(root, "scrollFracX")),
                FracU16(ReadDouble(root, "scrollFracY")));
        }

        if (type is "historyNav")
        {
            var direction = ReadString(root, "direction");
            var delta = string.Equals(direction, "back", StringComparison.OrdinalIgnoreCase) ? -1 : 1;
            return ControlCommand.HistoryGo(correlation, ctx, delta);
        }

        return null;
    }

    private static ushort FracU16(double? value)
    {
        if (value is null || double.IsNaN(value.Value))
        {
            return 32768;
        }

        if (value.Value <= 0)
        {
            return 0;
        }

        if (value.Value >= 1)
        {
            return 65535;
        }

        return (ushort)Math.Round(value.Value * 65535);
    }

    private static byte ButtonU8(string? button)
        => button switch
        {
            "middle" => 1,
            "right" => 2,
            _ => 0,
        };

    private static byte ModsU8(JsonElement root)
    {
        if (!root.TryGetProperty("modifiers", out var mods) || mods.ValueKind != JsonValueKind.Object)
        {
            return 0;
        }

        byte v = 0;
        if (IsTrue(mods, "ctrl")) v |= 1;
        if (IsTrue(mods, "shift")) v |= 2;
        if (IsTrue(mods, "alt")) v |= 4;
        if (IsTrue(mods, "meta")) v |= 8;
        return v;
    }

    private static bool IsTrue(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;

    private static double? ReadDouble(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var p))
        {
            return null;
        }

        return p.ValueKind == JsonValueKind.Number ? p.GetDouble() : null;
    }

    private static string? ReadString(JsonElement root, string name)
        => root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}
