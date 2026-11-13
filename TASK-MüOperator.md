# MüOp - The MücroOperator: open tasks

A PocketOperator-like groovebox on the Maschine Mikro MK3, `#/muop`. What's built (the brief, v1, v2 parts 0–11):
[DONE-MüOperator.md](DONE-MüOperator.md). This file: the usage concept (reference) and the open / later tasks.

## Usage concept

Goals: no menu diving, consistent and intuitive, never more than "hold one thing + use one control".
Two hands: one holds, the other picks / turns / taps.

**Hold a button = its page.** While held, the page owns the controls; release = back to playing. No latching.

| Control | Role on every page |
|---|---|
| Page button held | The page is active. The display shows the page and the current parameter as `name: value` (shown while held, blanks 3 s after release). |
| `< >` | Pick the parameter. |
| Encoder turn | Change the value. |
| Encoder push | Do it / apply (e.g. generate). |
| Pads | The page's choices / targets (tracks, patterns, FX, roots, chords). A page that doesn't use the pads leaves them playable. |
| Strip | The page's one continuous control (amount, macro); its LEDs show the stored value. No page held = filter. |
| Lights | Everything the page uses is lit dim, active / selected bright, everything else off. |

Rules:
- **Short press** (released before ~300 ms, nothing else touched) may trigger the page's main action. It fires on
  *release*, so never for timing-critical buttons (PLAY, STOP, REC).
- **Track buttons** (PAD MODE = drums, KEYBOARD = notes, CHORDS): pressing selects that track; holding it also shows
  that track kind's page.
- **ERASE / DUPLICATE** are plain hold + pad modifiers (no parameters).
- **SHIFT** = what's printed: SHIFT + pad = the function printed on the pad, SHIFT + button = the button's printed
  second function (modifier page: other pages win when held together). SHIFT combos a page covers are dropped.
- **Same gesture, meaning by track kind:** VARIATION, step editing, PLUG-IN do the fitting thing for drums / notes / chords.

### Pages

| Page (hold) | Pads | `< >` + encoder | Strip | Push / short press |
|---|---|---|---|---|
| SELECT | tracks (select) | kind, octave, clock, length, harmony | – | – |
| PATTERN | patterns (select / chain) | – | – | – |
| PERFORM | FX 1–8 track, 9–16 mix | FX settings (later) | FX amount (later) | – |
| CHORDS | 12 roots + 4 scales | root, scale, voicing | – | press = chords track |
| VARIATION | playable | density, déjà vu, bias, spread, steps, auto | déjà vu | generate |
| PLUG-IN | playable (drums: drum sound select) | sound, the instrument's parameters | macro / morph (later) | push = randomize, short = A/B |
| Held step pad (STEP mode) | hold + later step = length | note / chord, length | – | – |
| MUTE / SOLO (open) | tracks (drums track: drum sounds) | – | – | – |
| TEMPO / SWING / VOLUME | – | value (VOLUME: `< >` track / master) | – | – |
| SEARCH | playable | sound browser | – | short press = next sound |
| SHIFT (modifier) | the printed pad functions | – | density (live) | – |

### Harmony concept

- **Song key**: root + scale, set on the CHORDS page. Note steps store scale degrees and chords store chord degrees,
  so changing the key transposes the song without breaking it.
- **The first chords track is the harmony source.** Its chord holds until the next one; with a clock divider a
  16-step progression spans 4 or 16 bars under a one-bar riff.
- Notes tracks have a **harmony mode**: free / transpose (+ chord root) / follow (chord tones). Drums are not affected.

---

## Open

### 1. Web app page
- [ ] Pattern overview: all tracks × 16 steps of the current pattern, clickable, with the playhead.
- [ ] Sound visualizer (scope / spectrum of the master, from the meter analysers).
- [ ] Chain view (the 16 patterns + the chain, click to queue / edit).
- [ ] WAV recording of the master (MediaRecorder): keep a jam.
- [ ] Song file save / load (JSON): backup, move songs between computers.
- [ ] Computer keyboard shortcuts (space = play, …).
- [ ] MIDI routing presets per synth (port, channel, which tracks), app only.
- [ ] Mixer: MIDI ↔ internal switch in the strip; MIDI tracks: fader sends CC 7 (volume) to the synth.
- [ ] Favorites list (rename).
- [ ] Audio inputs: latency compensation (send MIDI earlier by the input latency, set by ear or measured), channel
  pair choice on multi-channel interfaces, Drive on the inputs.

### 2. MUTE / SOLO on the device
- [ ] MUTE / SOLO + pad: per track (pads show the tracks like SELECT), per drum sound on a drums track.
  (Mute / solo per track exist in the song and the app mixer already.)

### 3. Workflow: drops
- [ ] Any way to generate a drop now and then? Ideas:
  - "Drop" param on the VARIATION page: every 8 / 16 bars the bar before goes sparse (kick + hats only or
    silence on the last beats), then the full pattern hits on the 1.
  - Drop = a PERFORM FX recorded into a pattern (sweep / gate / tape stop on the last bar) and chained before the main one.
  - Auto density curve: with Auto on, density walks down over n bars and snaps back (build-up / breakdown).

### 4. Sounds
- [ ] PLUG-IN page: strip = macro / morph.
- [ ] Sound tuning: rework the sounds that feel weak (needs listening feedback, `src/engine/instruments/`).
- [ ] More engines: samples (drum kits as WAV/OGG one-shots), smplr, Faust / AudioWorklet.
- [ ] Keep it simple? Plug in an FM1 and do the MIDI thing (MIDI out + audio inputs work now); MIDI / audio routing
  presets for your fav synth (app only, see 1).
- [ ] Mutable Instruments DSP as engines (`../MI-Eurorack`, STM32 projects = **MIT**, keep the copyright notice; don't use
  the brand / module names as product names). C++ → WebAssembly (Emscripten, not installed yet; commit the built `.wasm`)
  → AudioWorklet node per track, behind the existing `Melodic` / `DrumKit` contract (SEARCH / STAR / page select work as is).
  - **Plaits** first: float DSP at 48 kHz, 16 engines incl. bass drum / snare / hi-hat models → melodic instruments + a
    drum kit from one port. Monophonic: one instance per voice (chords). Harmonics / timbre / morph → PLUG-IN page
    parameters, strip for live morph.
  - **Rings** (resonator, 48 kHz): pads / plucks, also as an effect on other tracks.
  - **Elements** (32 kHz internal, heavier CPU): one voice per track, needs resampling.
  - **Braids** (96 kHz, integer DSP): low priority, Plaits covers most of it.
  - Watch: sample-accurate note starts inside the 128-sample worklet block (Plaits renders 12–24-sample blocks),
    wasm size (speech / wavetable data).

## Later

- **Harmony:** probable key from the chord history (how many chords fit each of the 24 keys), suggestions grouped into
  diatonic / functional (secondary dominants) / related keys / chromatic; passing chords (dom7 a semitone below the
  target, or a tritone away before a dom7); chords outside the scale. Pentatonic "chords" are stacked scale steps
  (quartal-ish, shown as e.g. "E*").
- **VARIATION:** save the generator settings in the song; a "sound" target (vary the track's sound with déjà vu; until
  then PLUG-IN + push randomizes the sound); Grids-style drum map (own data, Grids is GPL-3.0) if the Marbles-style
  drums aren't enough.
- **Notes:** per-track Poly setting (SELECT page) to let notes overlap (pads, drones).
- **Sounds:** keep the "(edited)" browser entry across reloads (store it in the song).
- **PERFORM:** strip = FX amount, FX settings on `< >`, more track FX (octave up, random steps), per-track sends
  instead of the whole mix.
- **SHIFT functions that need features first:**
  - SHIFT + pad 5 Quantize, 6 Quantize 50 %: live-recorded hits (needs off-grid timing / micro offsets per step).
  - SHIFT + button printed second functions: ERASE / Replace (record overwrites), REC / Count-In, RESTART / Loop,
    FOLLOW / Grid (quantize grid), DUPLICATE / Double (pattern length ×2, needs pattern length), MUTE / Choke,
    FIXED VEL / 16 Vel (pads = one sound at 16 velocities), NOTE REPEAT / Arp.
