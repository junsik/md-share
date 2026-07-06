const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const globalState = globalThis as { __mdShareSweepStarted?: boolean };
  if (globalState.__mdShareSweepStarted) return;
  globalState.__mdShareSweepStarted = true;

  const { sweepExpired } = await import("./lib/store");
  const run = async () => {
    try {
      const removed = await sweepExpired();
      if (removed > 0) {
        console.log(`[md-share] sweep removed ${removed} expired document(s)`);
      }
    } catch (error) {
      console.error("[md-share] expiry sweep failed", error);
    }
  };
  void run();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
