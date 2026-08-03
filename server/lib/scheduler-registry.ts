// Phase B.5 - Scheduler Registry. Every scheduler in this codebase already
// follows the same shape (bare setInterval + tickRunning guard + its own
// lastTickAt); this does NOT replace that - it's a single shared place each
// one's tick() reports to on the way out, so "last run / duration / failures
// / heartbeat" can be read in one call instead of importing 9 separate
// heartbeat getters with 9 different shapes. Schedulers self-register: the
// first call to recordSchedulerTick(name, ...) for a given name creates its
// entry, so nothing needs to be wired up anywhere else.

export interface SchedulerStat {
  name: string;
  running: boolean;
  lastTickAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  totalRuns: number;
  totalFailures: number;
}

const registry = new Map<string, SchedulerStat>();

const getOrCreate = (name: string): SchedulerStat => {
  let entry = registry.get(name);
  if (!entry) {
    entry = { name, running: true, lastTickAt: null, lastDurationMs: null, lastError: null, totalRuns: 0, totalFailures: 0 };
    registry.set(name, entry);
  }
  return entry;
};

// Called once per tick by every scheduler (success or failure) - `running`
// reflects whether the scheduler is still actively scheduled, not whether
// this particular tick succeeded; a scheduler that calls stop() should pass
// running=false on its final report (or just stop reporting - see
// markSchedulerStopped below for the explicit case).
export const recordSchedulerTick = (name: string, durationMs: number, error?: string | null): void => {
  const entry = getOrCreate(name);
  entry.running = true;
  entry.lastTickAt = new Date();
  entry.lastDurationMs = durationMs;
  entry.totalRuns += 1;
  if (error) {
    entry.lastError = error;
    entry.totalFailures += 1;
  } else {
    entry.lastError = null;
  }
};

export const markSchedulerStopped = (name: string): void => {
  const entry = getOrCreate(name);
  entry.running = false;
};

export const getSchedulerRegistry = (): SchedulerStat[] => [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
