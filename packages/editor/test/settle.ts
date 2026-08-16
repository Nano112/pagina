/**
 * Waiting for the editor to be finished, in a jsdom test with fake timers.
 *
 * Everything in the app is debounced (400 ms serialize, 500 ms write, 300 ms preview), so the
 * timers have to be advanced — but advancing them is not enough on its own. React's scheduler runs
 * its work on a `MessageChannel`, which fake timers do not control, and TipTap's own view updates
 * land on the microtask queue behind it. Under load — several jsdom suites running in parallel — a
 * single `advanceTimersByTimeAsync` therefore returns before React has committed, and the
 * assertions that follow see a document one step behind. That is a *test* race, not an app one:
 * it disappears when the file runs alone, which is exactly what makes it worth fixing here rather
 * than by loosening the assertions.
 *
 * So each round advances the fake clock, then yields a real macrotask for React, and the whole
 * thing is repeated: a commit can schedule the next timer, and a timer can schedule the next
 * commit.
 */
import { act } from "react";
import { vi } from "vitest";

/** A real macrotask. `setTimeout` is faked; `MessageChannel` is not. */
const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

/**
 * Advances past every debounce in the app and lets the work behind them settle.
 *
 * Bounded rather than `runAllTimers` because the status bar keeps a `setInterval` running.
 */
export async function settle(ms = 2_000): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {
      await macrotask();
    });
  }
}
