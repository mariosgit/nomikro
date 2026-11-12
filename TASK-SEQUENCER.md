# TASK

Check the implementation

in the end it just sets some bits in a buffer and dumps it out to hid...

See how it is implemented now, give me a short overview.

Make Suggestions to optimize.

---

# Status (2026-11-12)

The basics are done and verified on the hardware: lights (pads, strip, buttons), screen text, output queue
(lights before screen, coalesced), pad input (multi-pad reports, pressure), buttons / encoder / touch strip.
How the driver works, measured timing and hardware facts: [`src/maschine/README.md`](src/maschine/README.md) and [`CLAUDE.md`](CLAUDE.md).
The review history (bugs found + fixed, test rounds) is in git history of this file.

**Reliable enough to build on.** Open items, in suggested order:

## 1. Safety net

- [ ] **Unit tests (vitest).** Decoders (`pads.ts`, `buttons.ts`) and the LED byte mapping (`lights.ts`) are pure functions.
  Use real reports from `.devlog/hw.jsonl` as fixtures: multi-pad report, encoder wrap, strip, all buttons, LED bytes per color/level.
  Right now a regression only shows up on the device.
- [ ] **Unplug / replug test** (≈ 1 min, needs a human). The code handles it (App `connect`/`disconnect`, mode aborted,
  new driver instance), but no one has tried it.
- [ ] **Long-run test.** All runs so far lasted minutes. A hanging `sendReport` would freeze the lights, since the queue waits forever.
  Soak 30–60 min (light show, `bench` before/after, check the log for errors). Consider a write timeout in the queue.

## 2. Input events (needed for the sequencer)

- [ ] Pick the report by `reportId` (0x01 buttons, 0x02 pads) instead of by length.
- [ ] **Edges, not snapshots:** the button callback fires with the full state (every 25 ms while the strip is touched).
  Diff the button bits → `buttondown` / `buttonup`, plus `encoder` (delta) and `strip` events. One emitter for everything,
  with timestamps (`event.timeStamp`, or the device timestamp bytes 7–8).
- [ ] **Pad sensitivity:** the device's own press event needs firm pressure (presses seen at 392..3348 of 4095, median 1262).
  Light touches only arrive as pressure updates. Generate press/release from the pressure stream with an adjustable threshold
  + hysteresis, and derive velocity from the rise. Keep the device event as a fallback.

## 3. Lights layers

The light show and pad feedback share one state, so `clear()` per frame wipes the feedback.
Use a few layers (e.g. `background` = sequencer grid, `overlay` = held pads / playhead), each an 80-byte buffer,
composed into the report on flush (the topmost non-zero byte wins).

## 4. Clock

The light show runs on `setTimeout`: fine for visuals, jittery for music, and throttled to ~1 Hz in background tabs.
Schedule against `AudioContext.currentTime` (lookahead scheduler or an AudioWorklet clock), and let the lights follow on the next flush.
Same clock for MIDI out later (Web MIDI timestamps).

## 5. Screen

- [ ] Reuse one `OffscreenCanvas` instead of creating a canvas per `set()`.
- [ ] Drawing API besides text: `screen.draw(ctx => …)` / `screen.blit(bitmap)` for a step grid, playhead, values.
- A full frame costs ~80 ms on the wire. Redraw only on change, and keep it off the hot input path.

## Known limits (documented, not solved)

- One browser tab per device (two tabs would both write).
- Background tabs throttle timers.
- Pad/strip raw level 0 is a dim light, not off. Pads could get 4 levels like the buttons (raw `[1, 0, 2, 3]`), unverified.
