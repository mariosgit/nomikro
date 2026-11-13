# MüOp - The MücroOperator

make an App that is somewhat similar to a PocketOperator
(when u see mü here, transcripe it to the greek char in the app)

it should have
* drum track
* melodic track, bass track, chords track
* punch in effects would be cool, hold a key then each pad does some FX.

try to map it to the buttons and pads of the device as close as possible, u can "repurpose" the least significant once to something else...


---

# Status (2026-11-12): v1 built and tested by hand, `#/muop`

Mapping and controls: see the page (cheat sheet) and `src/apps/muop/controller.ts`.
- 2 tracks: 8 synth drums (pads 1–8), melody (A minor over 16 pads). PAD MODE / KEYBOARD switch, STEP = step edit.
- 16 patterns × 16 steps, PATTERN + pads = select / chain (switches at the bar end), DUPLICATE / ERASE + pad.
- PLAY / STOP / REC (live recording, quantized to the nearest step), TEMPO / SWING / VOLUME + encoder, strip = low-pass.
- Song saved in localStorage.
- Metronome: SHIFT + TAP (shared engine part, `src/engine/metronome.ts`).

Since then (v2 so far): 16 tracks (SELECT + pad), PERFORM punch-in FX, sound engines per track (SEARCH / STAR),
track volume. Details in the list below.

## v2 usage concept

Goals: no menu diving, consistent and intuitive, never more than "hold one thing + use one control".
Two hands: one holds, the other picks / turns / taps.

**Hold a button = its page.** While held, the page owns the controls; release = back to playing. No latching.

| Control | Role on every page |
|---|---|
| Page button held | The page is active. The display shows the page and the current parameter as `name: value` (shown while held, blanks 3 s after release). |
| `< >` | Pick the parameter. |
| Encoder turn | Change the value. |
| Encoder push | Do it / apply (e.g. generate). Has no LED: the display says "push = …" when the page has an action. |
| Pads | The page's choices / targets (tracks, patterns, FX, roots, chords). A page that doesn't use the pads leaves them playable. |
| Strip | The page's one continuous control (amount, macro); its LEDs show the stored value. No page held = filter. |
| Lights | Everything the page uses is lit dim, active / selected bright, everything else off. |

Rules:
- **Short press** (released before ~300 ms, nothing else touched) may trigger the page's main action, e.g. VARIATION =
  generate again with the current settings. It fires on *release* (only then is it known that it wasn't a hold), so
  never for timing-critical buttons (PLAY, STOP, REC). Most pages: short press does nothing.
- **Track buttons** (PAD MODE = drums, KEYBOARD = notes, CHORDS): pressing selects that track (on press, as today);
  holding it also shows that track kind's page.
- **ERASE / DUPLICATE** are plain hold + pad modifiers (no parameters).
- **SHIFT** = what's printed: SHIFT + pad = the function printed on the pad, SHIFT + button = the button's printed
  second function. (Built as a modifier page, so other pages win when held together.) A SHIFT combo that a page
  covers (e.g. previous sound, master volume) is dropped. SHIFT + pad keeps the pads silent; while SHIFT is held, the pads show the 16 functions dimmed.
- **Same gesture, meaning by track kind:** VARIATION, step editing, PLUG-IN do the fitting thing for drums / notes / chords.
- Check on the device that every page button can be held with one hand while the other reaches `< >`, the encoder
  and the pads.

Implementation: a declarative `Page` (button, params with `get` / `step(delta)` / `format`, optional `pads()` /
`padDown()` / `strip()` / `apply()` / `tap()`), one active page in the controller. From the same data:
the button lights, the display text and the **Controls cheat sheet** on the app page (so they stay in sync).
Do this refactor first, then move the existing modifiers onto it (PERFORM, SELECT, PATTERN, TEMPO / SWING / VOLUME).

### Pages

| Page (hold) | Pads | `< >` + encoder | Strip | Push / short press |
|---|---|---|---|---|
| SELECT | tracks (select) | track settings: kind, sound, octave, name, clock ×/÷, pattern length, harmony mode (free / transpose / follow), MIDI out | – | – |
| PATTERN | patterns (select / chain) | – | – | – |
| PERFORM | FX 1–8 track, 9–16 mix | FX settings (later) | FX amount (sweep position, echo feedback) | – |
| CHORDS (hold) | 12 roots + 4 scales | scale, voicing, inversion, octave | – | – |
| VARIATION | playable | generator settings per track kind (density, spread, bias, length, …), target: pattern / sound | déjà vu (loop vs. change) | push = generate, short press = generate again |
| PLUG-IN | playable (or drum sound select on drums) | sound parameters of the track (drum: per drum sound) | macro / morph | – |
| Held step pad (STEP mode) | – | step: note / chord, velocity, length, p-locks (pitch, decay, sound params) | – | – |
| MUTE / SOLO | tracks (drums track: drum sounds) | – | – | – |
| TEMPO / SWING / VOLUME | – | value (VOLUME: `< >` track / master) | – | – |
| SEARCH | playable | sound of the track | – | short press = next sound |
| SHIFT (modifier) | the printed pad functions | – | – | – |

### Harmony concept

- **Song key**: root (C..B) + scale (minor, major, dorian, pentatonic, …), set on the CHORDS page. Note steps store
  scale degrees and chords store chord degrees, so changing the key transposes the song without breaking it.
- **The chords track is the harmony source.** The chord on the current step is the "current chord"; it holds until the next chord.
  With a clock divider (÷4, ÷16) a 16-step progression spans 4 or 16 bars under a one-bar riff.
- Every notes track has a **harmony mode** (SELECT page): `free` = plays the scale, `transpose` = the chord's degree is
  added to its notes (degree 3 turns an Am riff into Dm, stays in the scale), `follow` = pads are mapped to the chord tones
  (nothing sounds wrong; auto bass: degree 0 = chord root, octave / fifth as variations). Drums are not affected.
- This replaces the separate transpose track on T16.

---

## v2 ideas (by page, suggested order)

### 0. Done
- [x] PERFORM + pad: punch-in FX, momentary (PO style). Pads 1–8 on the selected track (`src/apps/muop/fx.ts`: loop 1/2/4/8,
  retrig ×2/×3, reverse, half time = step remapping, the song position runs on underneath), pads 9–16 on the mix
  (`src/engine/fx.ts` master bus: LP / HP sweep, gate, pump, echo, reverb, crush, slow down / tape stop).
  REC on while playing = recorded into the pattern (`Pattern.fx[step]`), ERASE + PERFORM (+ pad) clears.
- [x] Sound engine per track: `src/engine/instruments/` (basic, Tone.js), page select or SEARCH, stored in the song per track.
- [x] SEARCH = next sound for the current track, STAR = random variation (temporary, not saved),
  VOLUME + encoder = track volume (saved in the song), master via `< >`. Engines take a `random` flag (`chooser()`).
- [x] 16 tracks, SELECT + pad selects (pads show the tracks while held). Track kinds: drums / notes / chords.
  T1 Drums, T2 Bass (notes, octave -1, Sub lead), T3 Chords (Pad), T4 Lead; PAD MODE / KEYBOARD (bass ↔ lead) / CHORDS
  are shortcuts. Chords: pads 1–8 diatonic triads, 9–16 seventh chords (A minor). v1 songs migrate (drums → T1, melody → T4).

### 1. Page framework
- [x] `Page` abstraction + controller refactor (`src/apps/muop/page.ts`), cheat sheet generated from the pages.
  Display stays on while a page button / step is held (`screen.hold()`), blanks 3 s after release.
- [x] Move PERFORM, SELECT, PATTERN, DUPLICATE, ERASE, TEMPO / SWING / VOLUME onto it (VOLUME: `< >` track / master).

### 2. SHIFT
- [x] SHIFT + pad = the functions printed on the pads (SHIFT is a modifier page: pads silent, usable ones lit dim):
  - 1 Undo, 2 Redo, 3 Step Undo, 4 Step Redo: undo history of pattern edits (`src/apps/muop/history.ts`, pattern
    snapshots). Step = one edit, Undo = a whole gesture (while something is held / a recording pass).
    Settings (tempo, volume, sound, octave) are not undone.
  - 7 Nudge <, 8 Nudge >: rotate the current track one step (drums in STEP mode: the selected sound only).
  - 9 Clear (the current track in the pattern), 10 Clear Auto (the recorded FX of the pattern), 11 Copy, 12 Paste
    (the track's steps, into a track of the same kind; whole patterns: DUPLICATE).
  - 15 Octave −, 16 Octave +: the track's octave (notes / chords).
- [x] SHIFT + TAP = metronome. SHIFT + SEARCH / SHIFT + VOLUME dropped: covered by the SEARCH page (encoder browses,
  short press = next) and the VOLUME page (`< >` track / master).
- Later (needs features we don't have yet), see "Later: SHIFT functions" below.

### 3. SELECT page (track settings)
- [ ] Fill empty tracks 5–16: kind + sound.
- [ ] Track name, octave.
- [ ] Clock multiplier / divider per track (Performer: per-track divisor): ×2, ×1, ÷2, ÷4, ÷16 steps per clock step.
  Drums: double-time hats, half-time patterns. Chords at ÷4 / ÷16 = one chord per beat / bar.
- [ ] Pattern length per track (polymeter).
- [ ] Harmony mode per notes track: free / transpose / follow (see the harmony concept).
- [ ] MIDI out per track (channel), later as an "instrument".

### 4. Key + harmony (CHORDS page, chords track)
- [ ] Song key: root + scale (today fixed to A minor: `SCALE` / `ROOT` in `model.ts`). Pads, chords and generators follow.
- [ ] Chords track = harmony source; transpose / follow on the notes tracks (harmony concept above).
- [ ] More chord voicings (inversions, sus) as CHORDS page parameters.
- [ ] Chord suggestions on the normal chords play view (no page needed): after a chord, the pads of likely next chords
  light brighter. Idea from Floyd Steinberg's "Chorder"
  (https://www.floydsteinberg.com/extension/www.floydsteinberg.com/webmidi/chorder/chorder.html, no license on its JS:
  take the idea, write our own):
  - next chords = weighted moves from the current root: V +7 (1.0), IV +5 (0.9), vi +9 (0.85), ii +2 (0.75),
    vii° +11 (0.7), secondary dominant (0.65), iii +4 (0.6), color chords same root (0.5), chromatic ±1 dom7 (0.4).
  - probable key = how many chords of the history fit each of the 24 keys; group suggestions into diatonic /
    functional (secondary dominants) / related keys / chromatic.
  - passing chord: dom7 a semitone below the target (or a tritone away before a dom7).
  - secondary dominants / passing chords once chords outside the scale exist.

### 5. VARIATION page (generators)
- [ ] Hold VARIATION: `< >` + encoder = settings, strip = déjà vu, push = generate into the current pattern / track,
  short press = generate again. Per track kind:
  - drums: trigger generator à la Mutable Instruments **Grids**: a 2D map of drum patterns (X / Y = style),
    per-voice density.
  - notes: à la **Marbles**: random rhythm (density, bias, jitter) + random notes quantized to the scale
    (spread, bias, steps), "déjà vu" = how much the random sequence loops vs. changes. Notes from the current chord
    when the track follows the chords.
  - chords: random progression along the chord suggestion weights.
- [ ] Target "sound": a random variation of the track's sound (moves here from STAR).
- Source: `../MI-Eurorack` (fork of pichenettes/eurorack). Licenses (checked in the README + file headers):
  - Marbles (`marbles/random/`: `t_generator`, `x_y_generator`, `quantizer`, …): **MIT**, can be ported, keep the copyright notice.
  - Grids (`grids/pattern_generator.cc`, `grids/resources.cc` = the pattern map): **GPL-3.0** (AVR project). Porting code
    or the map data makes μOp GPL-3 (nomikro is LGPL-2.1). Alternative: own implementation of the idea (density
    thresholds over a map of patterns) with our own pattern data.
  - Trademark: don't use "Mutable Instruments" or the module names (Grids, Marbles) as names in the app.

### 6. Step page (hold a step in STEP mode)
- [ ] Note / chord value (works today with the encoder), velocity.
- [ ] Variable note length (notes / chords): today every note lasts 0.85 step. Length per step as a parameter, and/or
  hold a step + tap another step = tie. Live recording keeps how long the pad was held.
- [ ] Per-step parameter locks (drums: pitch / decay; later any sound parameter).

### 7. Sounds (PLUG-IN page, STAR, SEARCH)
- [ ] PLUG-IN page: sound parameters per track (drums: per drum sound), strip = macro / morph.
- [ ] STAR = save the current sound (engine + settings) as a favorite preset; SEARCH browses sounds incl. favorites.
- [ ] Sound tuning: rework the sounds that feel weak (needs listening feedback, `src/engine/instruments/`).
- [ ] More engines: samples (drum kits as WAV/OGG one-shots), smplr, Faust / AudioWorklet, MIDI out as an "instrument".
- [ ] Mutable Instruments DSP as engines (`../MI-Eurorack`, STM32 projects = **MIT**, keep the copyright notice; don't use
  the brand / module names as product names). C++ → WebAssembly (Emscripten, not installed yet; commit the built `.wasm`)
  → AudioWorklet node per track, behind the existing `Melodic` / `DrumKit` contract (SEARCH / STAR / page select work as is).
  - **Plaits** first: float DSP at 48 kHz, 16 engines incl. bass drum / snare / hi-hat models → melodic instruments + a
    drum kit from one port. Monophonic: one instance per voice (chords). Harmonics / timbre / morph → PLUG-IN page
    parameters, p-locks, strip for live morph.
  - **Rings** (resonator, 48 kHz): pads / plucks, also as an effect on other tracks.
  - **Elements** (32 kHz internal, heavier CPU): one voice per track, needs resampling.
  - **Braids** (96 kHz, integer DSP): low priority, Plaits covers most of it.
  - Watch: sample-accurate note starts inside the 128-sample worklet block (Plaits renders 12–24-sample blocks),
    wasm size (speech / wavetable data).

### 8. More
- [ ] Later: SHIFT functions that need features first:
  - SHIFT + pad 5 Quantize, 6 Quantize 50 %: live-recorded hits (needs off-grid timing / micro offsets per step).
  - SHIFT + pad 13 Semitone −, 14 Semitone +: song root (with the key setting, part 4).
  - SHIFT + button printed second functions: ERASE / Replace (record overwrites), REC / Count-In, RESTART / Loop,
    FOLLOW / Grid (quantize grid), DUPLICATE / Double (pattern length ×2, needs pattern length), MUTE / Choke,
    FIXED VEL / 16 Vel (pads = one sound at 16 velocities), NOTE REPEAT / Arp.
- [ ] MUTE / SOLO + pad: per track (pads show the tracks like SELECT), per drum sound on a drums track.
- [ ] PERFORM page: strip = FX amount, more track FX (octave up, random steps), per-track sends instead of the whole mix.
