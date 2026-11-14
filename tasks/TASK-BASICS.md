# Basics: open tasks

The driver (`src/maschine/`) is done and verified on the hardware, see [DONE-BASICS.md](DONE-BASICS.md).
How it works, measured timing and hardware facts: [`src/maschine/README.md`](../src/maschine/README.md) and [`CLAUDE.md`](../CLAUDE.md).

## 1. Safety net

- [ ] **Unit tests (vitest).** Decoders (`pads.ts`, `buttons.ts`) and the LED byte mapping (`lights.ts`) are pure functions.
  Use real reports from `.devlog/hw.jsonl` as fixtures: multi-pad report, encoder wrap, strip, all buttons, LED bytes per color/level.
  Right now a regression only shows up on the device.
- [ ] **Long-run test.** All runs so far lasted minutes. Soak 30–60 min (light show, `bench` before/after, check the log
  for errors, e.g. `Write timeout`). Writes time out after 1 s now (`m.writeTimeout`), so a hanging write no longer freezes the queue.

## 2. Screen

- [ ] More `screen.draw()` in μOp (idea): the track's steps + playhead while STEP mode is held (keep the OLED blanking rule).

## Known limits (documented, not solved)

- One browser tab per device (two tabs would both write).
- Background tabs throttle timers.
- Pad/strip raw level 0 is a dim light, not off. Pads could get 4 levels like the buttons (raw `[1, 0, 2, 3]`), unverified.
