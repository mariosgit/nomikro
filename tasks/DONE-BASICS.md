# Basics - done

The driver basics. All done, TASK-BASICS.md is closed (2026-11-14).
How the driver works, measured timing and hardware facts: [`src/maschine/README.md`](../src/maschine/README.md) and
[`CLAUDE.md`](../CLAUDE.md). The review history (bugs found + fixed, test rounds) is in the git history of TASK-BASICS.md.

## The brief

Check the implementation. In the end it just sets some bits in a buffer and dumps it out to HID...
See how it is implemented now, give me a short overview. Make suggestions to optimize.

## Status (2026-11-12)

Done and verified on the hardware: lights (pads, strip, buttons), screen text, output queue (lights before screen,
coalesced), pad input (multi-pad reports, pressure), buttons / encoder / touch strip. Reliable enough to build on.

## Input events (needed for the sequencer)

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

## Lights layers

- [x] `m.lights.layer(name, z?)` in `src/maschine/lights.ts`, composed on flush (topmost non-zero byte wins), only sent
  if the composed report changed. The shell removes an app's layers on app switch. Lab mode `layers` shows it.
  Why: the light show and pad feedback shared one state, so `clear()` per frame wiped the feedback. Now e.g.
  `background` = sequencer grid, `overlay` = held pads / playhead, each an 80-byte buffer.

## Clock

- [x] `src/engine/clock.ts`, a lookahead scheduler (100 ms ahead, 25 ms tick in a worker: hidden tabs don't throttle it).
  Timebase `performance.now()` ms: runs without a user gesture, Web MIDI uses it natively; audio converts per event with
  `toAudioTime()` (`src/engine/audio.ts`, via `getOutputTimestamp()`, so the sound is heard at the step time).
  BPM / swing (50..75 %, MPC-style) changeable while running. Lights via `clock.at(time, fn)`.
  Measured (lab mode `clock`, 120 and 200 BPM): steps handed out ≥ 83 ms ahead, lights fire 1 ms late on average, < 2 ms max.
- [x] Checked by hand: metronome by ear, encoder BPM / strip swing live, tab in the background (no gaps between bars in the log).

## Screen (2026-11-14)

- [x] Reuse one `OffscreenCanvas` instead of creating a canvas per `set()`.
- [x] Drawing API besides text: `screen.draw((ctx, w, h) => …)` for a step grid, playhead, values. (No `blit()`:
  draw an `ImageBitmap` with `ctx.drawImage` inside `draw()`.)
- [x] Redraw only on change, target 15–25 fps: `Screen` sends only the changed rectangle, frames capped at
  `maxFps` (default 20), only the newest pending frame is kept. Verified on camera + measured (lab mode `screen-fps`):
  one-row text / playhead / a narrow full-height bar ≈ 20 fps (1 report per frame), full-screen changes ≈ 10.5 fps
  (2 reports), lights latency during streaming avg 22–37 ms, max ~55 ms.
  - Found on the device (lab mode `screen-rects`): report 0xE0 takes any rectangle (header x / page / width / pages),
    but it must be the full 264 bytes. Short reports are faster on the wire (8 ms per 64-byte packet) but get paired
    up: the device draws the first and swallows the next one. So ~38 ms per report is the floor, ~25 fps max.
- [x] μOp: `say()` writes directly (the 30 ms debounce is gone, the driver merges frames).
- [x] μOp value bar: page parameters (`Param.bar()` in `src/apps/muop/page.ts`) show a bar under `name: value` while the
  page is held: a fill for values (tempo, swing, volume, variation, instrument params, log scale where the param is log),
  from the center for ± values (octave, bipolar params), one filled segment for choices (kind, clock, harmony, auto,
  root, scale, voicing, option params). Line 2 + bar change together (bottom half, one report). Checked by hand (TEMPO, SELECT).
  The sound browser parameter has no bar.

## Unplug / replug (2026-11-14)

- [x] Bug: after a replug the header showed Connected, but μOp stayed at "Connect the device to play" and lab modes didn't
  restart (a page reload fixed it). Cause: Chrome left a write to the unplugged device pending forever, the output queue
  waited on it, so the old task's cleanup never finished and the next task (they run one after another) never started.
  Fix: write timeout (`m.writeTimeout`, 1 s) + `m.close()` on the HID disconnect event (queued / later writes fail at once,
  input off). The shell closes the old driver; a task ended by an unplug is logged as `task … ended: device disconnected`,
  not as an error; μOp / screen-fps catch their fire-and-forget writes.
- [x] Tested by hand: unplug / replug while lab `screen-fps` and while μOp ran: both restart by themselves (log: `connected`
  → `task` right after).

## Closing (2026-11-14)

- [x] **Long-run test:** light show for 30 min (`bench` before / after, then `stress`): no errors, no write timeouts in the log.
  Bench before → after: lights report 16.0 → 16.2 ms, screen report 36.9 → 37.9 ms, lights latency during screen writes
  49–51 → 49–50 ms. Stress (40 rounds, screen on): all pads green (no lost lights reports).
- Dropped: **unit tests** for the decoders / LED mapping. Finished, verified on the device, rarely touched, and the
  `replay` lab mode re-runs recorded input through the real code path. Tests would pay off for changing logic
  (μOp harmony / variation, song load / migration), not here.
- Dropped: the step grid + playhead on the display (the pads show it already).
- Known limits moved to [`CLAUDE.md`](../CLAUDE.md) ("Known limits").
