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
| SELECT | tracks (select) | track settings: kind, octave, clock ×/÷, length, later harmony mode (name, MIDI out: app page) | – | – |
| PATTERN | patterns (select / chain) | – | – | – |
| PERFORM | FX 1–8 track, 9–16 mix | FX settings (later) | FX amount (sweep position, echo feedback) | – |
| CHORDS (hold) | 12 roots + 4 scales | root, scale, voicing | – | press = chords track |
| VARIATION | playable | density, déjà vu, bias, spread, steps, auto | déjà vu | push / short press = generate |
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
  - 13 Semitone −, 14 Semitone +: song root (part 4).
  - 15 Octave −, 16 Octave +: the track's octave (notes / chords).
- [x] SHIFT + TAP = metronome. SHIFT + SEARCH / SHIFT + VOLUME dropped: covered by the SEARCH page (encoder browses,
  short press = next) and the VOLUME page (`< >` track / master).
- Later (needs features we don't have yet), see "Later: SHIFT functions" below.

### 3. SELECT page (track settings)
Device: hold SELECT, pad = track, `< >` + encoder = setting of the selected track. App page: the track list (all 16
tracks) has the same settings plus the ones that are only set there (name, MIDI out).
- [x] Kind (empty / drums / notes / chords). Selecting an empty track makes it a notes track; a new track starts
  with a random sound. PAD MODE / KEYBOARD / CHORDS stay shortcuts to the tracks. Steps are kept when the
  kind changes (drums and notes are stored separately).
- [x] Octave (−3..+3, notes / chords).
- [x] Clock per track (Performer-style divisor): ÷16 ÷8 ÷4 ÷2 ×1 ×2 steps per 16th. The sequencer counts a song
  position (`tick`), each track derives its own step from it; track FX and live recording work in the track's steps.
- [x] Length per track 1–16 steps (polymeter); STEP view hides the steps beyond it, nudge rotates within it.
- [x] Track name: app page only.
- [x] MIDI out per track: app page only (port + channel, `src/engine/midi.ts`). The track then plays on the external
  gear instead of the internal sound (sequencer + pads; drums = General MIDI drum notes 36, 38, 42, 46, 39, 45, 50, 56).
- [x] Harmony mode per notes track (free / transpose / follow): see part 4.

### 4. Key + harmony (CHORDS page, chords track)
- [x] Song key: root + scale (`model.ts` SCALES: minor, major, dorian, mixolydian, phrygian, lydian, harmonic minor,
  pentatonic minor / major). CHORDS page: pads 1–12 = root, 13–16 = minor / major / dorian / mixolydian, `< >` + encoder
  = root / scale / voicing. Also on the app page and SHIFT + pad 13 / 14 (semitone ∓). Steps keep their scale degrees.
- [x] The first chords track is the harmony source (`harmony.ts`): its chord holds until the next one (wraps around its
  length). Notes tracks: free / transpose (+ chord root, in the scale) / follow (values = chord tones root, 3rd, 5th, …).
  SELECT page "Harmony" + track list. Live pads: while stopped, the last chord played on the chords track counts.
- [x] Voicings per chords track: close, 1st / 2nd inversion, open, sus2, sus4 (CHORDS page, track list). Names: Am/C.
- [x] Chord suggestions on the chords play view: the last chord = white, likely next chords brighter. Weights from
  Floyd Steinberg's "Chorder" idea (https://www.floydsteinberg.com/extension/www.floydsteinberg.com/webmidi/chorder/chorder.html,
  no license on its JS: own implementation): V +7 (1.0), IV +5 (0.9), vi +9 (0.85), ii +2 (0.75), vii° +11 (0.7),
  iii +4 (0.6), same root (0.5); added for minor keys ♭VI +8, ♭VII +10 (0.8), ♭III +3 (0.7).
- [ ] Later: probable key from the chord history (how many chords fit each of the 24 keys), suggestions grouped into
  diatonic / functional (secondary dominants) / related keys / chromatic; passing chords (dom7 a semitone below the
  target, or a tritone away before a dom7); chords outside the scale. Pentatonic "chords" are stacked scale steps
  (quartal-ish, shown as e.g. "E*").
- [ ] Random chord fill along the weights: VARIATION page (part 5).

### 5. VARIATION page (generators)
- [x] Marbles-style random patterns (`src/apps/muop/variation.ts`, own implementation, credits in the README).
  Hold VARIATION: `< >` + encoder = Density, Déjà vu, Bias, Spread, Steps, Auto; strip = déjà vu (violet);
  encoder push / short press = generate into the current pattern (from scratch on an empty track; drums in STEP mode:
  only the selected sound). Undo: SHIFT + pad 1. Settings + déjà vu loops per track, in memory (not saved).
  - Déjà vu: every track keeps a loop of random values per step and stream. 0 = all new, up to ½ = that share of
    steps gets new values (variation depth), ½ = locked (the same pattern; density / bias / spread reshape it and keep
    its identity), above ½ = steps replay other steps' values (shuffled).
  - drums: hit probability per drum sound by position in the bar (kick downbeats, snare 2 + 4, hats 8ths, open hat
    offbeats, toms / cowbell rare, more at the end of the bar), Bias = straight ↔ busy offbeats, velocity from accents.
  - notes: rhythm by density (strong steps favored), pitch from a distribution (Spread = range, Bias = low ↔ high),
    Steps = snap to the important notes (root > 5th > 3rd). Follow tracks get chord tones.
  - chords: chords on strong beats, picked along the next-chord weights; Spread = share of 7th chords,
    Steps = only the strongest moves.
  - Auto: a new variation every 1 / 2 / 4 bars while playing (written into the next pattern; VARIATION lit).
- [ ] Later: save the generator settings in the song; a "sound" target for VARIATION (vary the
  track's sound with déjà vu; until then STAR gives a random sound, separate from VARIATION);
  Grids-style drum map (own data, see the license note) if the Marbles-style drums aren't enough.
- Source / licenses: `../MI-Eurorack` (fork of pichenettes/eurorack). Marbles (`marbles/random/`): **MIT**.
  Grids: **GPL-3.0** (not used). Trademark: don't use "Mutable Instruments" or the module names as names in the app.

### 6. Step page (hold a step in STEP mode)
- [ ] Note / chord value (works today with the encoder), velocity.
- [ ] Variable note length (notes / chords): today every note lasts 0.85 step. Length per step as a parameter, and/or
  hold a step + tap another step = tie. Live recording keeps how long the pad was held.
- [ ] Per-step parameter locks (drums: pitch / decay; later any sound parameter).

### 7. Sounds (PLUG-IN page, STAR, SEARCH)
- [ ] PLUG-IN page: sound parameters per track (drums: per drum sound), strip = macro / morph.
- [ ] STAR = save the current sound (engine + settings) as a favorite preset; SEARCH browses sounds incl. favorites.
- [ ] Sound tuning: rework the sounds that feel weak (needs listening feedback, `src/engine/instruments/`).
- [ ] More engines: samples (drum kits as WAV/OGG one-shots), smplr, Faust / AudioWorklet.
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
  - SHIFT + button printed second functions: ERASE / Replace (record overwrites), REC / Count-In, RESTART / Loop,
    FOLLOW / Grid (quantize grid), DUPLICATE / Double (pattern length ×2, needs pattern length), MUTE / Choke,
    FIXED VEL / 16 Vel (pads = one sound at 16 velocities), NOTE REPEAT / Arp.
- [ ] MUTE / SOLO + pad: per track (pads show the tracks like SELECT), per drum sound on a drums track.
- [ ] PERFORM page: strip = FX amount, more track FX (octave up, random steps), per-track sends instead of the whole mix.


### 9. Workflow

- [x] step - the switching from step to drum/notes is combersome
  - in addidtion to the switching, can we have a temporary.. step hold - switches over to the other view - let me do things (e.g. select another drum sound) - step release, switches back.
  → done: STEP held (long or used with pads) = temporary switch, release = back; short press toggles as before.
- variation is cool
  - [x] the density is good for doing breaks, any way to quick access it ? Slider ? maybe shift+slider ?
    → done: SHIFT + strip = density of the selected track, live (orange bar), re-generated with déjà vu locked.
  - [ ] any way to generate a drop now and then ??? ideas ???
    - "Drop" param on the VARIATION page: every 8 / 16 bars the bar before goes sparse (kick + hats only or
      silence on the last beats), then the full pattern hits on the 1.
    - Drop = a PERFORM FX recorded into a pattern (sweep / gate / tape stop on the last bar) and chained before the main one.
    - Auto density curve: with Auto on, density walks down over n bars and snaps back (build-up / breakdown).

### 10. Display

- show the transport pos on the blank, move it over the disp to "burn" pixels evenly

- in the App, the pad drawing could show more stuff. like the drum pad sound or the chord or the set note in the step view

### 11 Web App page

To the side of the pad display...

- add a mixer view
  - can the audio engine capture usb audio ? My ext synth does audio out via usb, could be mixed into the app. ??
- add sound editor view - edit params for the sound on the selected track.
- also during perform - the table of FX from the bottom could be in the help.

