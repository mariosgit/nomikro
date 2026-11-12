# TASK

Check the implementation

in the end it just sets some bits in a buffer and dumps it out to hid...

See how it is implemented now, give me a short overview.

Make Suggestions to optimize.

---

# Findings (2026-11-12)

> Paths below are from before the restructure: the driver now lives in `src/maschine/`, the app in `src/app/` (see README).

## Overview: how it works now

The TS code is an almost 1:1 port of `src-py-old/pymikro`, including its quirks.

**Output (lights)**: `lights.set(type, ref, val, color)` stores `{val, color}` in a nested `any` object
(`state.pad["3"]`, `state.button["play"]`, ...). Each `lights.update()` then:

1. allocates a new `number[91]`: `[0x80, 0 × 90]`
2. walks the state and, per element, resolves the LED index (`order.indexOf(ref)`, with string/number coercion)
   and the byte (`4 × colors.indexOf(color) + val` for pads/strip, `brightness[val]` for buttons)
3. writes into the array at offset 1 (buttons, 39), 40 (pads, 16), 56 (strip, 25)
4. `device.write()` → `new Uint8Array` → `slice(1)` → `hid.sendReport(0x80, data)`

So yes: it's one 90-byte report, one byte per LED. Everything not in the state is sent as 0 (off).

**Screen**: `screen.set(text)` draws text on a new 128×32 canvas, packs it into 512 bytes (4 pages × 128 columns,
1 bit/pixel, bit set = pixel off) and sends it as two `0xE0` reports of 256 bytes each. A 3 s timer blanks the screen.

**Input**: `oninputreport` → `Array.from(bytes)` → both decoders try the report and pick it by **length**:
13 bytes = buttons/encoder/strip, 63 bytes = pads. Buttons: 6 bytes → BigInt → one bit per name in `button.order`.
Pads: only `bytes[0..2]` are decoded (pad index, state nibble + 12-bit pressure). Only pads have a callback; buttons are just logged.

## Bugs / correctness

1. ✅ *(fixed in code: `Pads.decode` returns all events up to the first all-zero slot; **waiting for the 2-pad test below**)*  
   **Pad report: only the first entry is read.** A 63-byte report is 21 × 3-byte slots `(pad, state|hi, lo)`.
   Chords or fast rolls arrive in one report, so every pad after the first is dropped (the Python version had the same bug).
   *(The 21-slot layout matches the report size and other MK3 drivers; still to be checked with a 2-pad press.)*
2. ✅ *(fixed with the API port: pressed → red, released → green, pressure updates leave the pad alone; not yet tested with a real pad press)*  
   **`demoBtnPad` never shows red.** It calls `set(pad, n, pressed ? 3 : 0, 'red')` and then `set(pad, n, released ? 3 : 0, 'green')`
   on the same key, so the second call always overwrites the first. Press → off, release → green, pressure updates → off.
3. ✅ *(fixed: throws `RangeError`, and `Color` is a union type)*  
   **Unknown color → garbage byte.** `indexOf` returns -1 → `-4 + val`, which wraps in the `Uint8Array` to 252–255. There's no warning.
4. ✅ *(fixed: default level 3, clamped to 0..3; the level-0 question is still open, see below)*  
   **`val` default is 4**, but pad/strip `val` is only 2 bits (`4 × color + val`). `val = 4` silently becomes the *next color* with level 0.
   The code also treats `val 0` as off, although byte `4 × color + 0` is probably the dimmest level of that color, so one level of 4 is lost.
5. ✅ *(fixed: `LedButton` type / `LED_BUTTONS` exclude them)*  
   **`enc-push` / `enc-touched` are in `button.order`** (input bits 39/40), so `lights.set('button', 'enc-push')` writes LED
   offsets 40/41, which are **pads 12/13**. The input and output orders share one list but aren't the same thing.
6. ✅ *(not a bug, checked on camera: the brightness order of the low 2 bits is `01 < 00 < 10 < 11`, so 13, 12, 10, 11 is monotonic; documented in `hardware.ts`)*  
   **Button brightness table `[0, 13, 12, 10, 11]`** isn't monotonic (it came from pymikro). It's unclear whether level 4 is
   really brighter than level 1. Check on camera.
7. ✅ *(fixed: listener removed, App handles disconnects)*  
   **`openDevice` adds a new `disconnect` listener on every connect** and never removes it (it leaks across reconnects; App handles disconnects anyway).
8. ✅ *(gone: no `setAll`)*  
   **`setAll(state)` keeps the caller's object** (aliasing). Later `set()` calls mutate the caller's literal.
9. ✅ *(removed)* Dead code: the `'enter'` special case (no such element) and the unused `vid`/`pid` in the `MaschineMikroMk3` constructor.

## Performance

Honest assessment: one 90-byte report per frame is trivial. At 30 fps the `indexOf`/allocation overhead doesn't matter in absolute terms.
The real costs are elsewhere:

- **Console logging on every input report** (button hex dump, decoded pads). Pad pressure streams fast, and DevTools logging is
  slow and can add input latency. Remove it or put it behind a debug flag.
- **`screen.set()` on every pad event** (in `demoBtnPad`) creates a canvas, renders text, packs 512 bytes and sends 2 reports
  per pressure update. Throttle it, or only update on press/release.
- **No write coordination.** The light show, the pad callback and the screen all call `device.write()` independently, and the
  pad callback doesn't `await`. Writes can pile up, and whoever writes last wins with their *own* state snapshot.

## Suggestions

### 1. Lights: keep the report buffer as the state (biggest simplification) ✅ DONE

> **Done (2026-11-12):** `src/lights.ts` keeps a `Uint8Array(90)` as the state, has typed `pad()` / `strip()` / `button()` / `clear()`,
> builds its lookup tables once, and clamps levels. Hardware constants moved from `maschine_mikro_mk3.json` to `src/hardware.ts`
> (`as const` → `Color`, `LedButton` union types). `MaschineMikroMk3.write(number[])` was replaced by `sendReport(id, Uint8Array)`.
> The light show was ported and checked on camera (all 5 scenes OK).

```ts
const BTN = 0, PAD = 39, STRIP = 55;          // offsets in the report data (without report id)
class Lights {
  private data = new Uint8Array(90);          // this IS the state, no object tree
  private dirty = false;
  // lookup tables built once from the JSON
  private padLed  = PADS.map(n => padOrder.indexOf(n));            // pad nb -> LED slot
  private btnLed  = new Map(LED_BUTTONS.map((b, i) => [b, i]));    // without enc-*
  private colorNb = new Map(colors.map((c, i) => [c, i]));

  pad(n: number, color: Color, level: 0|1|2|3)   { this.put(PAD + this.padLed[n], 4 * this.colorNb.get(color)! + level); }
  strip(i: number, color: Color, level: 0|1|2|3) { this.put(STRIP + i, ...); }
  button(name: ButtonName, level: 0|1|2|3|4)    { this.put(BTN + this.btnLed.get(name)!, BRIGHTNESS[level]); }
  off(n) / clear()                               { ... }
  private put(i: number, b: number) { if (this.data[i] !== b) { this.data[i] = b; this.dirty = true; } }
  flush(): Promise<void>                         // see 2.
}
```

- Typed, separate methods per element type: no `elemType` strings, no string/number coercion, no `any`.
- `Color` / `ButtonName` as union types derived from the JSON (`as const` or a `.ts` settings file) catch typos at compile time.
- No allocation per frame: `sendReport(0x80, this.data)` sends the buffer directly.
- `put()` only marks dirty on a real change, so an unchanged frame costs nothing.

### 2. One writer: dirty flag + coalesced flush ✅ DONE

> **Done (2026-11-12):** `lights.flush()` sends only when dirty, keeps at most one report in flight, and re-sends after the write
> if the state changed meanwhile. A failed write keeps the state dirty. `Screen` does the same for frames: it skips a frame
> identical to the last one sent/queued and keeps only the latest pending frame. Auto-flush (microtask/rAF) is *not* done;
> callers still call `flush()` explicitly.

- `flush()`: if a write is in flight, just mark it pending. When the write finishes, send once more if still dirty.
  At most one lights report is in flight, and it always carries the latest state.
- Optionally auto-flush on `queueMicrotask`/`requestAnimationFrame`, so callers just set LEDs and never call `update()`.
- The same goes for the screen: keep the last 512 bytes, skip identical frames, and send at most one frame in flight.

### 3. Layers instead of one shared state (needed for a sequencer)

Right now the light show and the pad feedback fight over the same state, because `setAll({})` wipes the pad feedback every frame.
Use a few small layers (e.g. `background` = show/sequencer grid, `overlay` = held pads / playhead) and compose them into the report buffer
on flush (overlay byte ≠ 0 wins). That's 90 bytes × N layers, so it's cheap.

### 4. Input

- Pick the report by `event.reportId` (0x01 buttons, 0x02 pads) instead of by length.
- Decode **all** pad slots of a report (see bug 1).
- Read the bytes directly (`bytes[i >> 3] & (1 << (i & 7))`) instead of `Array.from` + BigInt.
- Emit **events**, not snapshots: diff the button bitmask against the previous one → `buttondown` / `buttonup`,
  `encoder` (delta), `strip`. Use one `EventTarget`/emitter for everything instead of only `setPadCallback`.
  A sequencer needs press/release edges and timestamps (`event.timeStamp`), not "currently pressed" lists.

### 5. Screen

- Reuse one `OffscreenCanvas` instead of creating a canvas per call.
- Expose `screen.draw(ctx => ...)` / `screen.blit(bitmap)` besides `set(text)`, e.g. for a step grid or a playhead.
- Make blanking optional (a sequencer will want a permanent display).

### 6. Timing (sequencer outlook)

The light show loop is `setTimeout`-based. That's fine for visuals but jittery for a sequencer, and it is throttled to ~1 Hz
in background tabs. For musical timing, schedule against `AudioContext.currentTime` (lookahead scheduler, or an
AudioWorklet clock) and let the lights simply follow the clock on the next flush.

## Open checks (camera)

Test bench: the app has modes (buttons on the page, or `curl 'localhost:9000/__hw/run?mode=<mode>&...'`), see `src/app/modes/`.

- [x] **Pad report with 2 pads pressed at once** (your test, 15:36): confirmed. Simultaneous pads arrive in one report (`0a 1b e1 0b 18 a8 00…` = pads 6 + 7), and the list ends with zeros.
- [x] **Pad/strip level 0** (`mode=pad-levels`): **not off**. Raw level 0 lights dim in every color (≈ level 1); levels 2/3 are clearly brighter.
  Lights keeps byte 0 = off and levels 1..3, so nothing changes. *Possible later:* if pads follow the same order as the buttons
  (`01 < 00 < 10 < 11`), raw `[1, 0, 2, 3]` would give pads 4 levels like the buttons.
- [x] **Button bytes** (`mode=buttons&values=…`, 32 values on the button column): bytes 0–3 and 255 are off (also ≥128, presumably).
  Otherwise only the low 2 bits count: `01` dimmest < `00` dim < `10` bright < `11` brightest (5/9/13, 4/8/12/…/112, 6/14/126, 7/11/15/63/127).
- [x] **Touch strip direction** (`mode=strip`): LED 24 (blue) is at the right end, so LED 0 is left.

### Your turn: 2-pad test (≈ 1 min)

1. Make sure the app tab is open and connected (the light show runs on the device).
2. On the page, click **"Test: input monitor"** (or tell me and I switch it via curl).
3. Press and release, with some pause between:
   - one pad alone (e.g. pad 1 bottom left)
   - **two pads at exactly the same time** (e.g. 1 + 4, slap both with two fingers)
   - three or four pads at once (flat hand)
   - a few buttons, turn the encoder a bit, touch the strip
4. Expected: every pressed pad turns **red**, released ones **green**, the display shows `Pads held: …`,
   and the page lists `pads: 0↓1234 3↓987 …` (pad number, ↓ press / ↑ release, pressure).
   If only one of two pads lights up, the slot decoding is wrong.
5. Tell me when done. Everything is in `.devlog/hw.jsonl` (raw hex + decoded), and I'll check the report layout from there.

## Round 2: feedback from the input test (2026-11-12)

What you saw and what the log / measurements say:

| Observation | Cause | Fix |
|---|---|---|
| Encoder: touch + push yes, turning no | TS port kept the Python byte indexes, but Python had the report id at index 0. Encoder position was read from byte 7 (a timestamp) instead of byte 6 | `buttons.ts` rewritten with the verified layout (below). Monitor shows an encoder counter (display + page) |
| Strip only shows "buttons: -" | same index bug (strip read from bytes 10/12 instead of 9/11), and the monitor only printed buttons | fixed; monitor shows the strip value and lights the strip LED under the finger |
| 2 pads "at the same time" light up delayed | the device often reports them ~10 ms apart (separate reports). The real delay: every pad event also redrew the display (2 × 264-byte reports ≈ 80 ms), and the next LED report queued behind it | **one output queue in `MaschineMikroMk3`, lights before screen.** Measured LED latency while a display frame is written: ~96 ms → **~46 ms** (one screen half + 16 ms LED write) |
| 5 pads released, LEDs turn off one by one, ~1 s | partly the same queueing; partly real: the releases in the log are spread over ~350 ms (fingers lift at different times) | as above |
| Some pads stay red | **not reproduced.** The input is clean (every press has a release in both sessions, no unknown state codes). Replaying your recorded reports 3× through the same code path, plus a 40-round lights/screen stress test 3×, always ended correct | fixed what was certainly wrong: lights report was 90 bytes, the descriptor says **80** (different USB transfer length than the firmware expects). Errors from un-awaited writes now go to the dev log. **Please re-test**, see below |

Measured (mode `bench`): LED report 16 ms on the wire (80 bytes = 2 USB packets, ≈ 8 ms per packet → max ~60 LED updates/s);
screen frame 2 × ~38 ms. One report at a time on the wire, so the screen is expensive: avoid redrawing it on every event.

**Button report (0x01) layout, verified from raw reports:**
`0..5` button bits (incl. enc-push = bit 39, enc-touched = bit 40) · `6` encoder position 0..15 (wraps) ·
`7..8` timestamp LE (+25 per report while the strip is touched) · `9` strip position (0 = not touched, ~1..100+) · `11` strip 2nd value.

New tools: `MaschineMikroMk3.setButtonCallback()` (pressed buttons + encoder move + strip), `injectInput()`,
modes `bench`, `stress`, `replay` (replays recorded input from the dev log with original timing).

### Result of the re-test ✅ (2026-11-12)

- Encoder: OK (counter follows both directions).
- Strip: OK, range **1..200** (0 = not touched). Now `STRIP_MAX` in `hardware.ts`; the monitor maps it onto the 25 LEDs.
- Pads: react fast, all go green on release, **no stuck red pads** anymore (likely the 90 → 80 byte lights report, or the
  queueing; the old behavior couldn't be reproduced, so which one it was stays unknown). No write errors in the log.
- **New observation:** the device's own press event (state `0x10`) only fires at fairly high pressure. In this session presses
  came at pressure 392..3348 (median 1262, of 4095). Light touches only show up as `0x40` "touched" pressure updates.
  → **Follow-up idea (sequencer):** our own sensitivity. Use the pressure stream (`touched` + `pad_val`) with an adjustable
  threshold + hysteresis to generate press/release, and derive velocity from the rise. Optionally keep the device event as a fallback.

### Your turn (again, ≈ 2 min) — done

1. "Test: input monitor" on the page.
2. **Encoder:** turn it both ways. The display's 2nd line shows `Enc <count>`, +1 per click.
3. **Strip:** slide from the far left to the far right. A cyan LED should follow your finger. The log records the max value,
   which I need for scaling (now auto-ranging from 100).
4. **Pads:** play fast, several at once. Is it more responsive now?
5. **If a pad stays red**, look at the display's first line `Pads: …`:
   - pad number **listed** → the device never sent the release (input side)
   - pad **not listed** but still red → a lights report got lost (output side)

   Tell me which, and roughly when. The log has timestamps.
