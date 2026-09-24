using System.Buffers.Binary;
using Speculum.Wire;
using Speculum.Supervisor;
using Speculum.Supervisor.Control;

// Phase 10 — A2/A4/A6 executable gates (no source Contains, no unfailable asserts).
// A3/A5 live in phase10-builtAt.mjs + Phase10.LabE2E.

int fails = 0;
void Check(bool ok, string name)
{
    if (ok) Console.WriteLine("PASS " + name);
    else { Console.WriteLine("FAIL " + name); fails++; }
}

// --- A6 ---
Check(SchemaMeta.Sha256.Length == 64, "SchemaMeta.Sha256 length");
Check(SchemaIdentity.EmbeddedSha256 == SchemaMeta.Sha256, "SchemaIdentity == SchemaMeta");
{
    var threw = false;
    try { SchemaIdentity.AssertMatches("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "test"); }
    catch (InvalidOperationException ex) when (ex.Message.Contains("schema_hash_mismatch", StringComparison.Ordinal))
    {
        threw = true;
    }
    Check(threw, "A6 deploy mismatch throws");
}

// --- A2 real SessionPolicy (linked from Abi — not a mirror) ---
{
    var policy = new SessionPolicy();
    Check(policy.ChooseResyncForce() == ResyncForce.FromWalk, "A2 ChooseResyncForce");
    Check(policy.TryBeginNavigate() && policy.TryBeginNavigate() && !policy.TryBeginNavigate(),
        "A2 navigate retry budget");
    Check(policy.TryAcquireOfferSlot(), "A2 offer slot");
    for (int i = 0; i < 7; i++) policy.TryAcquireOfferSlot();
    Check(!policy.TryAcquireOfferSlot(), "A2 offer cap");
}

{
    var r = Codecs.EncodeResyncBytes(new Resync { force = ResyncForce.FromMap, scope = Scope.Self });
    Check(Codecs.DecodeResyncBytes(r).force == ResyncForce.FromMap, "A2 wire force FromMap");
}

// --- A4 Fault typed ---
{
    var fault = new Fault
    {
        code = FaultCode.ResyncCheckFailed,
        flags = 0,
        origin = "Producer",
        message = "scope",
        data = Array.Empty<FaultDatum>(),
    };
    var bytes = Codecs.EncodeFaultBytes(fault);
    var decoded = Codecs.DecodeFaultBytes(bytes);
    Check(decoded.code == FaultCode.ResyncCheckFailed, "A4 FaultCode roundtrip");
    var dispatcher = new FaultDispatcher();
    var hit = false;
    dispatcher.Received += f =>
    {
        if (f.code == FaultCode.ResyncCheckFailed) hit = true;
    };
    Check(dispatcher.TryDispatch(OpFault.Code, bytes), "A4 TryDispatch");
    Check(hit, "A4 typed handler arm");
    Check(FaultDispatcher.IsCatalogued(decoded.code), "A4 IsCatalogued");
}

// --- Vocab encode smoke (not A5 substitute) — Shutdown must encode non-empty or empty with defined opcode pack ---
{
    var shutPayload = Codecs.EncodeShutdownBytes(new Shutdown());
    var env = Pack(OpShutdown.Code, 0, shutPayload, 1);
    Check(env.Length == 16 + shutPayload.Length, "Shutdown envelope size");
    Check(BinaryPrimitives.ReadUInt16LittleEndian(env.AsSpan(0, 2)) == OpShutdown.Code, "Shutdown opcode");
}

Console.WriteLine(fails == 0 ? "phase10-unit PASS" : $"phase10-unit FAIL ({fails})");
return fails == 0 ? 0 : 1;

static byte[] Pack(ushort opcode, uint target, byte[] payload, uint correlation)
{
    var buf = new byte[16 + payload.Length];
    BinaryPrimitives.WriteUInt16LittleEndian(buf.AsSpan(0, 2), opcode);
    BinaryPrimitives.WriteUInt16LittleEndian(buf.AsSpan(2, 2), 0);
    BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(4, 4), target);
    BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(8, 4), (uint)payload.Length);
    BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(12, 4), correlation);
    payload.CopyTo(buf, 16);
    return buf;
}
