# MüOp - done

What's built, moved here from `TASK-MüOperator.md` (open and later items stay there).

## The brief

make an App that is somewhat similar to a PocketOperator
(when u see mü here, transcripe it to the greek char in the app)

it should have
* drum track
* melodic track, bass track, chords track
* punch in effects would be cool, hold a key then each pad does some FX.

try to map it to the buttons and pads of the device as close as possible, u can "repurpose" the least significant once to something else...

## v1 (2026-11-12), `#/muop`

Mapping and controls: see the page (cheat sheet) and `src/apps/muop/controller.ts`.
- 2 tracks: 8 synth drums (pads 1–8), melody (A minor over 16 pads). PAD MODE / KEYBOARD switch, STEP = step edit.
- 16 patterns × 16 steps, PATTERN + pads = select / chain (switches at the bar end), DUPLICATE / ERASE + pad.
- PLAY / STOP / REC (live recording, quantized to the nearest step), TEMPO / SWING / VOLUME + encoder, strip = low-pass.
- Song saved in localStorage.
- Metronome: SHIFT + TAP (shared engine part, `src/engine/metronome.ts`).

## v2

### 0. First steps
- PERFORM + pad: punch-in FX, momentary (PO style). Pads 1–8 on the selected track (`src/apps/muop/fx.ts`: loop 1/2/4/8,
  retrig ×2/×3, reverse, half time = step remapping, the song position runs on underneath), pads 9–16 on the mix
  (`src/engine/fx.ts` master bus: LP / HP sweep, gate, pump, echo, reverb, crush, slow down / tape stop).
  REC on while playing = recorded into the pattern (`Pattern.fx[step]`), ERASE + PERFORM (+ pad) clears.
- Sound engine per track: `src/engine/instruments/` (basic, Tone.js), page select or SEARCH, stored in the song per track.
- SEARCH = next sound for the current track, VOLUME + encoder = track volume (saved in the song), master via `< >`.
  (STAR = temporary random variation at first; replaced by the PLUG-IN page and favorites, part 7.)
- 16 tracks, SELECT + pad selects (pads show the tracks while held). Track kinds: drums / notes / chords.
  T1 Drums, T2 Bass (notes, octave -1, Sub lead), T3 Chords (Pad), T4 Lead; PAD MODE / KEYBOARD (bass ↔ lead) / CHORDS
  are shortcuts. Chords: pads 1–8 diatonic triads, 9–16 seventh chords. v1 songs migrate (drums → T1, melody → T4).

### 1. Page framework
- `Page` abstraction + controller refactor (`src/apps/muop/page.ts`), cheat sheet generated from the pages.
  Display stays on while a page button / step is held (`screen.hold()`), blanks 3 s after release.
- PERFORM, SELECT, PATTERN, DUPLICATE, ERASE, TEMPO / SWING / VOLUME moved onto it (VOLUME: `< >` track / master).

### 2. SHIFT
- SHIFT + pad = the functions printed on the pads (SHIFT is a modifier page: pads silent, usable ones lit dim):
  - 1 Undo, 2 Redo, 3 Step Undo, 4 Step Redo: undo history of pattern edits (`src/apps/muop/history.ts`, pattern
    snapshots). Step = one edit, Undo = a whole gesture (while something is held / a recording pass).
    Settings (tempo, volume, sound, octave) are not undone.
  - 7 Nudge <, 8 Nudge >: rotate the current track one step (drums in STEP mode: the selected sound only).
  - 9 Clear (the current track in the pattern), 10 Clear Auto (the recorded FX of the pattern), 11 Copy, 12 Paste
    (the track's steps, into a track of the same kind; whole patterns: DUPLICATE).
  - 13 Semitone −, 14 Semitone +: song root (part 4).
  - 15 Octave −, 16 Octave +: the track's octave (notes / chords).
- SHIFT + TAP = metronome. SHIFT + SEARCH / SHIFT + VOLUME dropped: covered by the SEARCH page (encoder browses,
  short press = next) and the VOLUME page (`< >` track / master).
- SHIFT + strip = density of the selected track, live (orange bar), re-generated with déjà vu locked (part 9).

### 3. SELECT page (track settings)
Device: hold SELECT, pad = track, `< >` + encoder = setting of the selected track. App page: the track list has the
same settings plus the ones that are only set there (name, MIDI out).
- Kind (empty / drums / notes / chords). Selecting an empty track makes it a notes track with a random sound.
  PAD MODE / KEYBOARD / CHORDS stay shortcuts to the tracks. Steps are kept when the kind changes.
- Octave (−3..+3, notes / chords).
- Clock per track (Performer-style divisor): ÷16 ÷8 ÷4 ÷2 ×1 ×2 steps per 16th. The sequencer counts a song
  position (`tick`), each track derives its own step from it; track FX and live recording work in the track's steps.
- Length per track 1–16 steps (polymeter); STEP view hides the steps beyond it, nudge rotates within it.
- Track name: app page only.
- MIDI out per track: app page only (port + channel, `src/engine/midi.ts`). The track then plays on the external
  gear instead of the internal sound (sequencer + pads; drums = General MIDI drum notes 36, 38, 42, 46, 39, 45, 50, 56).
- Harmony mode per notes track (free / transpose / follow): part 4.
- App track list: empty tracks hidden, "+ track" enables the next one (notes track, random sound).

### 4. Key + harmony (CHORDS page, chords track)
- Song key: root + scale (`model.ts` SCALES: minor, major, dorian, mixolydian, phrygian, lydian, harmonic minor,
  pentatonic minor / major). CHORDS page: pads 1–12 = root, 13–16 = minor / major / dorian / mixolydian, `< >` + encoder
  = root / scale / voicing. Also on the app page and SHIFT + pad 13 / 14 (semitone ∓). Steps keep their scale degrees.
- The first chords track is the harmony source (`harmony.ts`): its chord holds until the next one (wraps around its
  length). Notes tracks: free / transpose (+ chord root, in the scale) / follow (values = chord tones root, 3rd, 5th, …).
  SELECT page "Harmony" + track list. Live pads: while stopped, the last chord played on the chords track counts.
- Voicings per chords track: close, 1st / 2nd inversion, open, sus2, sus4 (CHORDS page, track list). Names: Am/C.
- Chord suggestions on the chords play view: the last chord = white, likely next chords brighter. Weights from
  Floyd Steinberg's "Chorder" idea (https://www.floydsteinberg.com/extension/www.floydsteinberg.com/webmidi/chorder/chorder.html,
  no license on its JS: own implementation): V +7 (1.0), IV +5 (0.9), vi +9 (0.85), ii +2 (0.75), vii° +11 (0.7),
  iii +4 (0.6), same root (0.5); added for minor keys ♭VI +8, ♭VII +10 (0.8), ♭III +3 (0.7).

### 5. VARIATION page (generators)
- Marbles-style random patterns (`src/apps/muop/variation.ts`, own implementation, credits in the README).
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
- Source / licenses: `../MI-Eurorack` (fork of pichenettes/eurorack). Marbles (`marbles/random/`): **MIT**.
  Grids: **GPL-3.0** (not used). Trademark: don't use "Mutable Instruments" or the module names as names in the app.

### 6. Step page (hold a step in STEP mode)
- Note / chord value (encoder). Velocity and per-step parameter locks: dropped (keep μOp simple).
- Note length (notes / chords): length per step 1..16 (track steps), stored as `lengths` in the pattern.
  - Hold a step: `< >` = Note / Length (lit), encoder changes it. Hold a step + tap a later step = lasts up to there.
  - Held-over steps glow dim in the note's color. A note sounds `length − 0.15` steps (ratchet FX: short hits).
  - REC: notes / chords get the length the pad was held. VARIATION: notes 1 step, chords until the next chord.
  - Nudge / clear / erase / copy / paste / undo carry the lengths; older songs load with length 1.
  - The next note cuts a long one (mono style, also chords); the dim glow stops there too.

### 7. Sounds (PLUG-IN page, STAR, SEARCH)
- Instruments declare their parameters (`ParamDef` in `src/engine/instruments/types.ts`: range, unit, log,
  options, random range); values per track in the song (`track.params`), live via `set()` (Tone drums: rebuilt).
- PLUG-IN page: Sound (browser) + the instrument's parameters, `< >` + encoder. Drums: pads 1–8 pick the drum
  sound (Tune / Decay / Tone / Level / Drive each). Push = randomize (stored), short press = back / forward (A/B).
- Drive (tanh soft clip, 2× oversampled): per drum sound in the kits, per track (bus, mixer / PLUG-IN) for all tracks.
- STAR = save the sound (instrument + values) as a favorite (localStorage, all songs). SEARCH = sound browser:
  instruments, the track's edited sound, favorites ★. App page: browser select, ☆ save, ★× delete.

### 9. Workflow
- STEP held (long or used with pads) = temporary switch to the other view, release = back; short press toggles.
- SHIFT + strip = live density for breaks (see part 2).

### 10. Display
- `screen.idle()` in the driver: while playing, the blanked display shows the position as in the app status bar,
  "P3  2.4 /3" (pattern, bar.beat of the cycle, cycle length in bars), small text, one frame per beat, moving one step
  per bar (bouncing) so the OLED wears evenly.
- App pads: drum names / notes / chords, STEP mode: the step values (×n = length).

### 11. Web app page
- Status bar above the pads: ▶ / ● rec / metro, position `P3 · 12.2`, cycle counter (tracks line up again after the
  LCM of their lengths / clocks), BPM / swing, key, master volume, level meter with peak hold, OVER (grey, red after clipping).
- Right panel (`panel.tsx`), below the tab line next to the pads: tabs Mixer / Sound / Inputs / Info (right aligned);
  holding a button longer than a tap switches it: PERFORM → FX table, PLUG-IN → sound editor, others → their help.
- Mixer: per track fader, meter, mute / solo, Drive, MIDI label (MIDI tracks: level / meter / Drive greyed out);
  Inputs strip; master fader + meter. Mute / solo stored in the song; the sequencer skips silent tracks
  (sound + MIDI), live pads still play.
- Sound editor: sliders / selects generated from the ParamDefs, drum sound buttons, Randomize, A/B, double click = default.
- Audio inputs (app only): USB audio of external synths, several at once (`src/engine/input.ts`, `src/apps/muop/inputs.ts`).
  Inputs tab: per input device / level / mute / meter / status (permission, unplugged → reopens on replug); saved on
  this computer (localStorage). Mixer: one "Inputs" strip (summed) → strip filter → PERFORM mix FX → master.
