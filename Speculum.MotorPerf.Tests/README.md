# Speculum.MotorPerf.Tests

Capacity / SLO checks against the motor-assert compose stack. Trait: `Category=MotorPerf`.

- Skipped without `MOTOR_ASSERT_API_BASE`
- Run by [`.github/workflows/perf.yml`](../.github/workflows/perf.yml) (schedule + main + manual) — **not** a required PR check
- SLOs documented in [docs/diagnostics.md](../docs/diagnostics.md) § Performance SLOs
