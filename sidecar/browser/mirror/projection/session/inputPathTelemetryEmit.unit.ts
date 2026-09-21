import assert from 'assert';
import {
  emitInputPathApplied,
  emitInputPathReject,
  inputPathAppliedPayloadBuildCount,
  inputPathRejectPayloadBuildCount,
  resetInputPathTelemetryEmitCounters,
} from './inputPathTelemetryEmit';

export async function runInputPathTelemetryEmitUnitTests(): Promise<void> {
  resetInputPathTelemetryEmitCounters();
  let sinkCalls = 0;
  let consoleCalls = 0;
  const sink = () => {
    sinkCalls += 1;
  };
  const onConsole = () => {
    consoleCalls += 1;
  };

  emitInputPathReject(false, sink, onConsole, 'stale_viewport', 'validate', 'click');
  emitInputPathApplied(false, sink, 'down');
  assert.strictEqual(sinkCalls, 0);
  assert.strictEqual(consoleCalls, 0);
  assert.strictEqual(inputPathRejectPayloadBuildCount, 0);
  assert.strictEqual(inputPathAppliedPayloadBuildCount, 0);

  emitInputPathReject(true, sink, onConsole, 'stale_viewport', 'validate', 'click');
  emitInputPathApplied(true, sink, 'down');
  assert.strictEqual(sinkCalls, 2);
  assert.strictEqual(consoleCalls, 1);
  assert.strictEqual(inputPathRejectPayloadBuildCount, 1);
  assert.strictEqual(inputPathAppliedPayloadBuildCount, 1);
}
