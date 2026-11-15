# TASK μOp without a computer: iOS / ESP32

Goal: play μOp from the Mikro without a laptop. A and B: **no internal sounds**, they only sequence, the sounds come
from AUv3s on an iPad or from external gear via MIDI. C: a standalone groovebox with its own sound.

## Why not just the web app on iOS

- iOS has no HID access for apps: IOKit HID / CoreHID are macOS only. GameController only covers game controllers and
  keyboards, CoreMIDI only class-compliant MIDI devices (the Mikro MK3 is neither), External Accessory needs MFi.
- All iOS browsers are WebKit: no WebHID, no Web MIDI, no Web Bluetooth.
- An AUv3 with its own HID driver would need USBDriverKit (iPadOS 16+, M-series iPads only, Apple entitlement), and
  an app extension probably can't reach the driver. Not worth it.

→ An **ESP32-S3** in between does the USB host part. Checked: the Mikro runs at **12 Mb/s (full speed)** and asks
for **480 mA** (`system_profiler SPUSBHostDataType`). The S3 / S2 host port does full speed; the original ESP32
(e.g. ESP32-WROOM-32: its USB socket is only a USB-serial chip) and the C3 have no USB host. Workaround for those:
a MAX3421E USB host controller over SPI ("USB Host Shield", USB_Host_Shield_2.0 library supports the ESP32), full
speed is enough for the Mikro. An S3 board costs about the same and needs no extra chip.
**ESP32-S2** (e.g. S2-WROVER): USB host yes, but **no Bluetooth** (Wi-Fi only) and a single core. Fine for
variant A (WebSocket bridge over WLAN); for B only with RTP-MIDI over WLAN or DIN instead of BLE-MIDI.
### Board at hand: Elecrow CrowPanel 1.28" rotary

Round 240×240 touch display + knob, **ESP32-S3R8**. USB host + BLE + PSRAM, so A and B both work on it, and in B
its colour display + knob could show what the aged OLED can't (track, chord, FX).

- **Checked (2026-11-15):** esptool: ESP32-S3 (QFN56) rev v0.2, WiFi + BLE, 8 MB embedded PSRAM, 16 MB quad flash.
  The USB header is the S3's **native USB** (vendor `0x303a`; Floyd Steinberg's ChordCrow firmware runs it as a USB
  MIDI device, so D+/D- reach the OTG controller, which can also be host).
- Before flashing our own firmware: back up ChordCrow (`esptool read_flash 0 0x1000000 chordcrow.bin`).

**Setup: USB header = host for the Mikro, UART header = firmware + logs.**

- **USB header** "USB IN (5V)" (5V / D- / D+ / GND; the FPC carries the same D-/D+, leave it unused): wired to a
  female USB-A socket, the Mikro's normal cable plugs in there. One 5 V supply (≥ 1 A) feeds both the board's 5V and
  the socket's 5V (the Mikro asks for 480 mA). The S3 has one OTG port: while it's host it can't be a USB-MIDI device.
- **UART header** (RX / TX / 5V / GND) to the USB-serial adapter: adapter TX → board RX, RX → TX, GND → GND,
  **3.3 V logic** (the S3 isn't 5 V tolerant), adapter 5V left open (the board runs from the 5 V supply).
  - Logs: serial monitor, 115200 baud.
  - Flashing: hold BOOT, press + release RESET, release BOOT → `esptool --port /dev/cu.<adapter> write_flash …`,
    then RESET. The Mikro stays plugged in.
  - Assumption to check first: the header is UART0 (the ROM bootloader only listens there): in flash mode
    `esptool --port /dev/cu.<adapter> flash_id` must answer "ESP32-S3".

[CrowPanel wiki:](https://www.elecrow.com/wiki/CrowPanel_1.28inch-HMI_ESP32_Rotary_Display.html)
[CrowPanel github](https://github.com/Elecrow-RD/CrowPanel-1.28inch-HMI-ESP32-Rotary-Display-240-240-IPS-Round-Touch-Knob-Screen)

Both variants mean porting μOp (sequencer, controls, projects); only the target differs.

## Variant A: AUv3 on the iPad, ESP32 = HID bridge

- ESP32-S3: USB host (ESP-IDF `usb_host` + HID host class), forwards the raw reports both ways over a **WebSocket
  over WLAN** (ESP as access point, Wi-Fi power save off). Doesn't understand the reports: 0x80 lights (80 bytes),
  0xE0 screen (264 bytes), input reports pass through as bytes.
- iPad: μOp as an AUv3 **MIDI FX** (`aumi`) in AUM / Loopy / Drambo …: MIDI goes straight to the other AUs, sample
  accurate from the render block.
- The host is the tempo / transport master: the AU reads tempo, beat position and play state from the host.
- Code reuse: the AU can embed **JavaScriptCore** and run the framework-free TS (model, sequencer, controller,
  harmony, variation) on a non-realtime thread with lookahead (as `clock.ts` does now), feeding a lock-free event
  queue that the render block sends out. So the TS is moved, not rewritten: Swift only for the AU shell, socket, UI.
- Risks: input / lights / screen go over WLAN (+5–20 ms jitter). **Check first:** can an AUv3 extension keep a
  local network socket open (Local Network permission)? CoreBluetooth in extensions is unreliable → WLAN only.

## Variant B: all of μOp on the ESP32

- Firmware (C++, ESP-IDF): Mikro driver, clock, sequencer, chains, recording, pages, lights, screen, projects.
  Reference for the structure: Performer (`../performer`, STM32, similar constraints). RAM is no problem
  (512 KB SRAM + PSRAM).
- MIDI out: **BLE-MIDI** (NimBLE; iOS supports it natively, 15 ms connection interval, some jitter). Optionally
  **DIN** (UART 31250 baud, a few parts, sub-ms timing from a hardware timer).
- The ESP is the tempo master: sends MIDI clock + start / stop, the host follows. Tape stop can really slow the clock.
- Works without an iPad: any BLE-MIDI (or DIN) receiver.
- Risks: BLE timing; the firmware dev loop is slower than the page reload + camera.
- Optional later: write the sequencer core once in C++/Rust, WASM for the web app, native for the ESP. One codebase
  instead of TS + C++.

## Variant C: Teensy 4.1, standalone groovebox with sound

Like B (μOp ported to C++ firmware), but on a **Teensy 4.1** with the **Teensy Audio Library**: the box makes its
own sound again, as the web app does.

- **Hardware:** Teensy 4.1 (Cortex-M7, 600 MHz, 1 MB RAM, slot for 8/16 MB PSRAM, SD card slot) + Audio Adaptor
  Board (SGTL5000 codec: headphone + line out, line in) or a plain I2S DAC.
- **USB host:** a separate host port (5-pin header, needs the host cable) + **USBHost_t36** (has HID support).
  The Mikro's reports are vendor defined: probably a small custom driver class (claim the interface, interrupt
  IN/OUT endpoints) instead of the ready-made keyboard / joystick classes. **Check first.**
- **Power:** the host port's 5 V goes through a current limiter (about 500 mA, check the 4.1 schematic). The Mikro asks
  for 480 mA (all LEDs bright): tight. Maybe feed the Mikro's 5 V separately.
- **USB device port at the same time:** the Teensy can be a class-compliant **USB MIDI (+ USB audio)** device.
  Plugged into an iPad (camera adapter) or a computer it appears as MIDI in/out and an audio interface: it plays its
  own sounds and also sequences AUv3s / DAWs over the cable. No Bluetooth on board (BLE-MIDI would need an extra
  module), DIN via UART is easy.
- **Sound engine (Teensy Audio Library, 44.1 kHz / 16 bit, 128-sample blocks ≈ 2.9 ms):**
  - Drums: `AudioSynthSimpleDrum`, noise + filter + envelope (like `instruments/basic.ts`), sample kits from SD /
    PSRAM (`AudioPlaySdWav`, `AudioPlayMemory`).
  - Melodic / chords: voices = oscillator / wavetable + ladder or state-variable filter + envelope. Rough budget:
    16–32 simple voices; chords need polyphony, so count voices per track.
  - The Tone.js sounds are not portable as is: rebuild the parameter sets (`ParamDef`) with these building blocks.
- **Master FX map almost 1:1 to library objects:** LP / HP sweep → `AudioFilterLadder` / `AudioFilterStateVariable`,
  gate / pump → `AudioEffectMultiply` / `AudioAmplifier` (or envelope) per step, echo → `AudioEffectDelay`
  (`AudioEffectDelayExternal` in PSRAM for long times), reverb → `AudioEffectFreeverb`, crush →
  `AudioEffectBitcrusher`, slow down → slow the clock + pitch the voices down (true tape stop for samples
  = variable playback rate). The strip DJ filter is the same filter pair. The CC map on channel 16 is still sent
  when tracks play external gear.
- **Mixer / volumes:** `AudioMixer4` cascades per track group + master gain, as in `sounds.ts`.
- **Tools:** Arduino / PlatformIO, the Audio System Design Tool (graph editor in the browser → C++ code).
- Risks: biggest port (sequencer **and** sound engine); the host port's power; Mikro HID with USBHost_t36 unproven.
- Cheaper start / board at hand: **Teensy 3.6** (180 MHz Cortex-M4F, 256 KB RAM, no PSRAM, host port +
  USBHost_t36 too, SD slot, discontinued). Audio without a codec board: its two 12-bit DACs (A21 / A22) via
  `AudioOutputAnalogStereo`, + RC low-pass, DC-blocking cap, small amp / buffer for headphones. Lo-fi but fine for
  a PO-style box. Expect ~¼ of the 4.1's voices, short delays only (RAM), samples from SD (few streams at once).
- Alternative board: Electrosmith Daisy Seed (STM32H7, better codec: 24 bit / 96 kHz, DaisySP DSP library), but its
  USB host support targets mass storage, HID would be more work than on the Teensy.

## Comparison

| | A: AUv3 + HID bridge | B: all on the ESP | C: Teensy groovebox |
|---|---|---|---|
| Sequencer runs in | AUv3 (TS in JavaScriptCore) | ESP firmware (C++) | Teensy firmware (C++) |
| Sound | the host's AUv3s | external | **its own** (+ external) |
| MIDI | into the host, sample accurate | BLE-MIDI (+ DIN) | USB MIDI device (+ DIN) |
| Tempo master | the host | the ESP (MIDI clock out) | the Teensy (MIDI clock out) |
| Without an iPad / computer | no | yes | yes |
| Weak spot | Mikro I/O over WLAN | BLE timing, port to C++ | biggest port, host power |
| Check first | network socket in an AUv3 extension | (safe: proven parts) | Mikro on USBHost_t36, 480 mA on the host port |

**Choosing:** iPad-centred, synced to the host → A. A standalone box that sequences anything, Performer style → B.
A standalone instrument with its own sound, PO style → C.

## Effects: channel 16 = FX track

Without sound there's no master FX bus. Split:

- **Track FX (PERFORM pads 1–8)** stay in the sequencer, pure step remapping (`src/apps/muop/fx.ts`):
  Loop 1/2/4/8, Retrig ×2/×3, Reverse, Half time. Nothing changes.
- **Global FX (pads 9–16) + strip DJ filter** become CC messages on **MIDI channel 16**. On the receiving side an
  FX chain on the master bus listens to channel 16 (AUM: filter / delay / reverb / bitcrusher / gain AUs on the
  master, MIDI learn), or the gear's own FX via MIDI learn.
- Channel 16 is reserved: no track may use it (warning in the track's MIDI setting).
- Punch-ins recorded into a pattern send the same CCs on playback.
- At rest every CC sits at its rest value. On stop and on FX off the rest values are sent again (no stuck filter).
- Curves are sent every ~10 ms while they move (3 bytes per CC, ~300 B/s per curve: fine over BLE). 7 bit is enough
  for curves; the receiver should smooth (most AUs do).

### Suggested CC map (channel 16)

Standard GM numbers where they mean the same thing, the rest from the undefined range 102–119.

| CC | Function | Rest | Driven by (web app behaviour to match) |
|---|---|---|---|
| 7 | Master level | 100 | volume |
| 74 | Low-pass cutoff | 127 (open) | **LP sweep**: 127 → 0 over one bar (exponential in Hz = linear in CC for most filters). Strip left half: centre → left = 127 → 0 |
| 102 | High-pass cutoff | 0 (open) | **HP sweep**: 0 → 127 over one bar. Strip right half: centre → right = 0 → 127 |
| 71 | Filter resonance | 20 | up (~90) while a sweep or the strip filter is engaged, back to rest on release |
| 103 | Gate level | 127 | **Gate**: every step 127 at the step start, 0 after half the step |
| 104 | Pump level | 127 | **Pump**: on each beat drop to 0, then rise back to 127 over ~1.2 steps (sidechain ducking) |
| 105 | Echo send | 0 | **Echo**: 0 → 100 on, 0 on off (the tail rings out in the delay) |
| 106 | Echo time | 3 steps | dotted 1/8 = 3 steps, as in the web app. Only needed if the delay isn't host-synced: then the value is the delay time in steps × 8 |
| 107 | Echo feedback | 60 | fixed; available for tweaking |
| 91 | Reverb send (GM) | 0 | **Reverb**: 0 → 100 on, 0 on off (tail rings out) |
| 108 | Crush mix | 0 | **Crush**: 0 → ~60 (about level with the dry mix) |
| 109 | Crush amount | 64 | fixed (bits / sample-rate reduction of the crusher) |
| 110 | Tape stop | 0 | **Slow down**: 127 while held, for a tape-stop effect; also see below |

**Slow down:** in B the ESP really slows its clock over a bar and also sends pitch bend down on all note channels.
In A the host owns the tempo, so only pitch bend + CC 110.

**Alternative for echo** (no delay plugin needed): note echo in the sequencer: repeat each note after 3 steps with
falling velocity (2–3 repeats). Can be a setting: echo as CC or as notes.

## Project data

| | A (AUv3) | B (ESP) | C (Teensy) |
|---|---|---|---|
| Current state | AU `fullState`, saved by the host with its session (iOS standard) | flash (LittleFS), autosave | SD card, autosave |
| Project library | App Group container (shared by the AU and its app), visible in the Files app | flash: songs are a few KB, hundreds fit | SD card: songs + sample kits |
| Edit / back up | the containing app: list, new / duplicate / rename / delete | a small web page served by the ESP (WLAN access point): list, import / export, MIDI file export | SD card in a computer, or over USB (MTP / serial); no WLAN |
| Exchange | `muop1:<gzip base64url>` text, same as the web app (`projects.ts`) | same | same (one file per song) |

- Keep `parseSong()` + the `muop1` format as the common format: songs move between the web app, A and B.
- A song carries the CC map version / FX channel, so an imported song plays the same FX.
- Not in the song (belongs to the device / setup): BLE pairing, WLAN, the receiver's MIDI learn.

## Steps

- [ ] 0. Web app first (testable today on the desktop): channel 16 FX track in `sounds.ts` / `sequencer.ts`: when MIDI
  out is used, global FX + strip filter also send the CC map above. Help page: the CC table. MIDI file export: optional
  channel 16 track with the recorded FX (the open "FX rendered" item in TASK-ProjectSharing).
  Testing against iPad AUv3s without an ESP: macOS Audio MIDI Setup → Bluetooth → *Advertise* makes the Mac a
  BLE-MIDI peripheral, the iPad connects (AUM: Bluetooth MIDI), the web app sends to that port via Web MIDI. Chrome
  itself can't be a BLE-MIDI device: Web Bluetooth is central only (no advertising, no GATT server).
- [ ] 1. ESP32-S3 HID bridge: open the Mikro, forward reports over a WebSocket. A needs it as is; for B it proves the
  USB host part with this Mikro.
- [ ] 2. WebSocket transport in `src/maschine/` (next to WebHID, same API above it): the web app drives the Mikro
  through the ESP; also runs in iOS Safari (page over http on the LAN: no `ws://` from an `https://` page).
- [ ] 3. Decide A, B or C. For A, first spike: AUv3 MIDI FX that holds a WebSocket to the ESP + runs TS in
  JavaScriptCore. For C, first spike: Teensy 4.1 opens the Mikro via USBHost_t36 (pads in, lights out, all LEDs bright
  on the host port's power) + one drum voice on the audio board.
- [ ] 4. Port: A = AU shell + JSC host; B = firmware sequencer + BLE-MIDI (+ DIN); C = firmware sequencer + sound
  engine + FX + USB MIDI.
- [ ] 5. Projects on the target (table above), `muop1` import / export.
