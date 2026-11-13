# `src/maschine`: Maschine Mikro MK3 driver (WebHID)

Framework-free TypeScript driver for the Native Instruments Maschine Mikro MK3 in the browser.
No dependencies, no React. Everything public comes from [`index.ts`](index.ts).
Needs a WebHID browser (Chrome/Chromium/Edge) and a secure context (`localhost` or https).
On Linux the device needs user access to its `hidraw` node, see [`50-ni-maschine.rules`](../../50-ni-maschine.rules).

The smallest complete app is [`examples/minimal`](../../examples/minimal/main.ts).

## Connect

```ts
import { connect } from './maschine';

// an already permitted device (works on page load), or null
let m = await connect();
// otherwise show the browser's device picker; needs a user gesture, so call it from a click handler
button.onclick = async () => { m = await connect({ prompt: true }); };
```

For your own connection handling: `HID_FILTER`, `isMaschineMikroMk3(device)`, `new MaschineMikroMk3().openDevice(hidDevice)`.

## Lights

The state is the report buffer itself: setters change bytes, and `flush()` sends them.

```ts
m.lights.pad(0, 'red');          // pad 0..15 (0 = bottom left), color, level 1..3 (default 3), 0 = off
m.lights.strip(24, 'blue', 2);   // touch strip LED 0..24, left → right
m.lights.button('play', 4);      // LED buttons, level 0..4
m.lights.pad(5, 'off');          // off
m.lights.clear();                // everything off
await m.lights.flush();          // send if changed
```

### Layers

`m.lights` is the bottom layer. `m.lights.layer(name, z?)` adds a layer on top (created on first use, higher z on top,
default above the existing ones), with the same setters. On flush, the topmost non-zero byte per LED wins, so `'off'`
on a layer is transparent: the layers below show through.

```ts
const grid = m.lights.layer('grid');        // e.g. sequencer steps
const overlay = m.lights.layer('overlay');  // held pads, playhead
grid.pad(3, 'green', 2);
overlay.pad(3, 'white');                    // covers the step
overlay.pad(3, 'off');                      // step visible again
m.lights.flush();                           // or grid.flush()
m.lights.removeLayer('grid');               // removeLayer() = all layers
```

- `clear()` clears only that layer. A change that's hidden under a higher layer sends nothing.
- `flush()` is cheap to call often: it only sends when something changed, keeps one report in flight, and always sends the latest state.
  You don't have to `await` it.
- Colors: `COLORS` / type `Color` (`'red'`, `'orange'`, … `'white'`). Button names: `LED_BUTTONS` / type `LedButton`.
- Levels are clamped. Unknown pads, strip LEDs or colors throw a `RangeError`.

## Screen

128×32 monochrome display.

```ts
m.screen.set('Hello\nWorld');    // 2 lines, optional font size: set(text, 14)
m.screen.blankAfter = 0;         // default: blank 3 s after the last set(); 0 = keep
m.screen.hold(true);             // no blanking while a button is held; hold(false) restarts the countdown
m.screen.clear();
```

Identical frames are skipped, and only the newest pending frame is kept.

## Input

Events with edges and held state (`m.input`, [`input.ts`](input.ts)):

```ts
const off = m.input.onAny((e) => {           // or m.input.on('padDown', (e) => …)
  switch (e.type) {
    case 'padDown':     e.pad; e.velocity /* 0..1 */; e.pressure /* 0..4095 */; break;
    case 'padPressure': e.pad; e.pressure; break;          // aftertouch while held
    case 'padUp':       e.pad; e.duration /* ms */; break;
    case 'buttonDown':  e.button; break;                   // BUTTONS name, incl. 'enc-push', 'enc-touched'
    case 'buttonUp':    e.button; e.duration; e.chorded; break;
    case 'encoder':     e.delta /* ±steps */; e.position /* 0..15 */; break;
    case 'strip':       e.position /* 1..200, 0 = released */; e.position2; break;
  }
});
off();                                       // unsubscribe

m.input.isHeld('shift');                     // modifiers: hold pattern + pad → m.input.isHeld('pattern') in padDown
m.input.heldButtons; m.input.heldPads; m.input.padPressure(3); m.input.strip;
m.input.sensitivity = { on: 300, off: 120, full: 2500, window: 8 };  // press, release, velocity 1 (0..4095), velocity window ms
```

- Every event has `time` (`performance.now()` timebase, from the HID report's `timeStamp`).
- `buttonUp.chorded`: something else went down while the button was held (pad, button, encoder turn, strip touch),
  so it was used as a modifier. A tap = short and not chorded. `enc-touched` (touching the encoder) never chords.
- Pads go down at pressure `on` (light touches count) or on the device's own press event (firm), and up below `off`
  or on the device's release. After a device release, threshold presses wait until the pressure was seen below `off`
  (no double hits). Velocity = peak pressure within `window` ms (default 8) after the crossing, `on` → 0, `full` → 1:
  a hit rises over a few ms (first sample ≈400, the device press ≈4 ms later ≈1000+). padDown is emitted when the device
  press arrives or the window ends, with the time of the crossing. Thresholds still to be tuned by hand.

Raw callbacks (the decoded reports, still available):

```ts
m.setPadCallback((pad) => {
  // pad.pad_nb 0..15, pad.pad_val pressure 0..4095, pad.pressed / pad.released / pad.touched (pressure update)
});

m.setButtonCallback((b) => {
  // b.btn_pressed: names of all buttons held right now (BUTTONS, incl. 'enc-push', 'enc-touched')
  // b.encoder_move: ±steps since the last report, b.encoder_pos 0..15
  // b.strip_pos_1: touch strip 1..200 (0 = not touched), b.strip_pos_2: second finger
});
```

- The button callback fires on every button report: button changes, encoder turns, and strip touches (every 25 ms while touched).
  It carries the full state.
- The device's own `pressed` event needs fairly firm pressure. Light touches only show up as `touched` pressure updates.
- Several pads changing at once arrive in one report. The callback fires once per pad.
- Reports are dispatched by report id: 0x01 buttons, 0x02 pads.

## Timing (measured)

| | |
|---|---|
| Lights report (80 bytes) | 16 ms on the wire, so at most ~60 updates/s |
| Screen frame (2 × 264 bytes) | ~80 ms |

There's one report on the wire at a time. `MaschineMikroMk3` queues all output, with lights before screen, so an LED change waits at most
for the screen half in flight (~46 ms worst case). **Don't redraw the screen on every input event** if latency matters.

## Hardware facts

- Pad LEDs: byte = 4 × color index + level. Raw level 0 is a dim light, not off; byte 0 is off.
- Button LEDs: bytes 0–3 and ≥ 128 are off. Brightness is in the low 2 bits, in the order `01 < 00 < 10 < 11` (hence `BUTTON_BRIGHTNESS = [0, 13, 12, 10, 11]`).
- Report layouts are documented in [`buttons.ts`](buttons.ts), [`pads.ts`](pads.ts), [`lights.ts`](lights.ts), and [`screen.ts`](screen.ts).

## Diagnostics

`m.onRawInput(reportId, bytes)` for raw input, `m.injectInput(reportId, bytes)` to feed recorded input,
`m.onWrite(reportId, size, ms, error?)` for write timing, `m.lights.raw(kind, index, byte)` for raw LED bytes.
