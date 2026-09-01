/**
 * Blueprint + action graph types (lab-design.md §5).
 */

export type ActionKind =
  | 'boot'
  | 'navigate'
  | 'sleep'
  | 'act'
  | 'evaluate'
  | 'snap'
  | 'opWindow.start'
  | 'opWindow.stop'
  | 'requestResync'
  | 'cpu.start'
  | 'cpu.stop'
  | 'iso'
  | 'collect.enable'
  | 'fold'
  | 'writeDossier'
  | 'injectFrame'
  | 'pushInput'
  | 'probe.turnstile'
  | 'probe.nestedApplyFailure'
  | 'probe.nestedHostReady'
  | 'probe.turnstileRectLadder'
  | 'probe.turnstilePaint'
  | 'probe.cssomSheetDump'
  | 'probe.paintDiff'
  | 'probe.cssomMatrix'
  | 'probe.launchTelemetry';

export type LabAction = {
  id: string;
  type: ActionKind;
  params?: Record<string, unknown>;
  dependsOn?: string[];
  awaits?: string[];
  queue?: string;
  continueOnFail?: boolean;
};

export type LabBlueprint = {
  id: string;
  description: string;
  sessionPolicy: 'cold' | 'reuse-live';
  defaultTelemetry?: Record<string, unknown>;
  queues: { name: string; actions: LabAction[] }[];
  fold?: string;
  artifacts?: string[];
  humanNotes?: string[];
};

export type ActionTerminalStatus = 'succeeded' | 'failed' | 'skipped';

export type ActionRuntimeState = {
  action: LabAction;
  queue: string;
  status: 'pending' | 'running' | ActionTerminalStatus;
  detail?: string;
};
