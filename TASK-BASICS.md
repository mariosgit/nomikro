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
- [/] **Unplug / replug test** (≈ 1 min, needs a human). The code handles it (App `connect`/`disconnect`, mode aborted,
  new driver instance), but no one has tried it.
- [ ] **Long-run test.** All runs so far lasted minutes. A hanging `sendReport` would freeze the lights, since the queue waits forever.
  Soak 30–60 min (light show, `bench` before/after, check the log for errors). Consider a write timeout in the queue.

## 2. Input events (needed for the sequencer)

- [x] Pick the report by `reportId` (0x01 buttons, 0x02 pads) instead of by length.
- [x] **Edges, not snapshots:** the button callback fires with the full state (every 25 ms while the strip is touched).
  Diff the button bits → `buttondown` / `buttonup`, plus `encoder` (delta) and `strip` events. One emitter for everything,
  with timestamps (`event.timeStamp`, or the device timestamp bytes 7–8).
- [x] **Pad sensitivity:** the device's own press event needs firm pressure (presses seen at 392..3348 of 4095, median 1262).
  Light touches only arrive as pressure updates. Generate press/release from the pressure stream with an adjustable threshold
  + hysteresis, and derive velocity from the rise. Keep the device event as a fallback.
  → Done in `src/maschine/input.ts` (`m.input`: events + held state + `buttonUp.chorded` for modifiers). Velocity = peak
  pressure in an 8 ms window after the threshold crossing (the device press arrives ≈4 ms after the first sample). Checked by hand with the defaults
  (on 300, off 120, full 2500, window 8 ms); retune in lab mode `events` (params on/off/full/window).

## 3. Lights layers

- [x] Done: `m.lights.layer(name, z?)` in `src/maschine/lights.ts`, composed on flush (topmost non-zero byte wins), only sent
  if the composed report changed. The shell removes an app's layers on app switch. Lab mode `layers` shows it.

The light show and pad feedback share one state, so `clear()` per frame wipes the feedback.
Use a few layers (e.g. `background` = sequencer grid, `overlay` = held pads / playhead), each an 80-byte buffer,
composed into the report on flush (the topmost non-zero byte wins).

## 4. Clock

- [x] Done: `src/engine/clock.ts`, a lookahead scheduler (100 ms ahead, 25 ms tick in a worker: hidden tabs don't throttle it).
  Timebase `performance.now()` ms: runs without a user gesture, Web MIDI uses it natively; audio converts per event with
  `toAudioTime()` (`src/engine/audio.ts`, via `getOutputTimestamp()`, so the sound is heard at the step time).
  BPM / swing (50..75 %, MPC-style) changeable while running. Lights via `clock.at(time, fn)`.
  Measured (lab mode `clock`, 120 and 200 BPM): steps handed out ≥ 83 ms ahead, lights fire 1 ms late on average, < 2 ms max.
- [x] Checked by hand: metronome by ear, encoder BPM / strip swing live, tab in the background (no gaps between bars in the log).

## 5. Screen

- [ ] Reuse one `OffscreenCanvas` instead of creating a canvas per `set()`.
- [ ] Drawing API besides text: `screen.draw(ctx => …)` / `screen.blit(bitmap)` for a step grid, playhead, values.
- A full frame costs ~80 ms on the wire. Redraw only on change, and keep it off the hot input path.

## Known limits (documented, not solved)

- One browser tab per device (two tabs would both write).
- Background tabs throttle timers.
- Pad/strip raw level 0 is a dim light, not off. Pads could get 4 levels like the buttons (raw `[1, 0, 2, 3]`), unverified.
