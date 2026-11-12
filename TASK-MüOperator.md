# MüOp - The MücroOperator

make an App that is somewhat similar to a PocketOperator
(when u see mü here, transcripe it to the greek char in the app)

it should have
* a drum track and a 
* melodic track
* punch in effects would be cool, held a key then each pad does some FX.

try to map it to the buttons and pads of the device as close as possible, u can "repurpose" the least significant once to something else...


---

# Status (2026-11-12): v1 built and tested by hand, `#/muop`

Mapping and controls: see the page (cheat sheet) and `src/apps/muop/controller.ts`.
- 2 tracks: 8 synth drums (pads 1–8), melody (A minor over 16 pads). PAD MODE / KEYBOARD switch, STEP = step edit.
- 16 patterns × 16 steps, PATTERN + pads = select / chain (switches at the bar end), DUPLICATE / ERASE + pad.
- PLAY / STOP / REC (live recording, quantized to the nearest step), TEMPO / SWING / VOLUME + encoder, strip = low-pass.
- Song saved in localStorage.
- Metronome: SHIFT + TAP (shared engine part, `src/engine/metronome.ts`).

## v2 ideas (suggested order)
- [x] PERFORM + pad: punch-in FX, momentary (PO style). Pads 1–8 on the selected track (`src/apps/muop/fx.ts`: loop 1/2/4/8,
  retrig ×2/×3, reverse, half time = step remapping, the song position runs on underneath), pads 9–16 on the mix
  (`src/engine/fx.ts` master bus: LP / HP sweep, gate, pump, echo, reverb, crush, slow down / tape stop).
  REC on while playing = recorded into the pattern (`Pattern.fx[step]`), ERASE + PERFORM (+ pad) clears.
- [ ] FX ideas for later: touch strip as FX amount (sweep position / echo feedback), more track FX (octave up, random steps),
  per-track sends instead of the whole mix
- [x] Sound engine per track: `src/engine/instruments/` (basic, Tone.js), page select or SEARCH,
  stored in the song per track.
- [x] SEARCH = next sound for the current track (SHIFT = previous), STAR = random variation (temporary, not saved),
  VOLUME + encoder = track volume (saved in the song), SHIFT + VOLUME = master. Engines take a `random` flag (`chooser()`).
- [ ] SHIFT + pad = the functions printed on the pads (as on the device):
  - 1 Undo, 2 Redo, 3 Step Undo, 4 Step Redo: an undo history of song edits. Step undo = one edit, Undo = a whole
    gesture / recording pass.
  - 5 Quantize, 6 Quantize 50 %: live-recorded hits (needs off-grid timing / micro offsets per step first).
  - 7 Nudge <, 8 Nudge >: shift the current track (or drum sound) one step left / right in the pattern (rotate).
  - 9 Clear (the current track in the pattern), 10 Clear Auto (the recorded FX / later p-locks), 11 Copy, 12 Paste
    (track or pattern clipboard).
  - 13 Semitone −, 14 Semitone +: transpose (song key / track); 15 Octave −, 16 Octave +: the track's octave
    (also covers "octave editable" below).
  - SHIFT + pad must keep pads silent; the pads show the 16 functions dimmed while SHIFT is held.
- [ ] Other printed second functions to consider: ERASE / Replace (record overwrites), REC / Count-In,
  RESTART / Loop, FOLLOW / Grid (quantize grid), DUPLICATE / Double (pattern length ×2), MUTE / Choke,
  FIXED VEL / 16 Vel (pads = one sound at 16 velocities), NOTE REPEAT / Arp, VARIATION (random variation, see the
  pattern randomization below).
- [ ] Sound presets: save a sound (engine + settings, e.g. a STAR result you like) under a name, browse them with SEARCH.
- [ ] Sound tuning: rework the sounds that feel weak (needs listening feedback, `src/engine/instruments/`)
- [ ] More engines: samples (drum kits as WAV/OGG one-shots), smplr, Faust / AudioWorklet, MIDI out as an "instrument"
- [x] 16 tracks, SELECT + pad selects (pads show the tracks while held). Track kinds: drums / notes / chords.
  T1 Drums, T2 Bass (notes, octave -1, Sub lead), T3 Chords (Pad), T4 Lead; PAD MODE / KEYBOARD (bass ↔ lead) / CHORDS
  are shortcuts. Chords: pads 1–8 diatonic triads, 9–16 seventh chords (A minor). v1 songs migrate (drums → T1, melody → T4).
- [ ] Fill empty tracks 5–16: choose a kind + sound (e.g. SELECT an empty track, then SEARCH cycles kinds / sounds)
- [ ] Track names / octave editable (e.g. SHIFT + encoder = octave), more chord voicings (inversions, sus)
- [ ] Variable note length (notes / chords): today every note lasts 0.85 step. Store a length per step
  (e.g. hold a step + another step = tie / length, or a gate value per step); live recording keeps how long the pad was held.
- [ ] More random, more fun: pattern randomization / generative patterns (STAR + PATTERN or similar, per track):
  - drums à la Mutable Instruments **Grids**: a 2D map of drum patterns (X/Y = style), per-voice density → pick / morph
    patterns with the encoder or the touch strip.
  - notes / chords à la **Marbles**: random rhythm (density, bias, jitter) + random notes quantized to the scale
    (spread, bias, steps), "déjà vu" = how much the random sequence loops vs. changes.
  - Source: `../MI-Eurorack` (fork of pichenettes/eurorack). Licenses (checked in the README + file headers):
    - Marbles (`marbles/random/`: `t_generator`, `x_y_generator`, `quantizer`, …): **MIT**, can be ported, keep the copyright notice.
    - Grids (`grids/pattern_generator.cc`, `grids/resources.cc` = the pattern map): **GPL-3.0** (AVR project). Porting code
      or the map data makes μOp GPL-3 (nomikro is LGPL-2.1). Alternative: own implementation of the idea (density
      thresholds over a map of patterns) with our own pattern data.
    - Trademark: don't use "Mutable Instruments" or the module names (Grids, Marbles) as names in the app.
- [ ] MUTE / SOLO + pad: per track (pads show the tracks like SELECT), per drum sound on a drums track
- [ ] Per-step parameter locks (hold step + encoder for drums: pitch / decay)
- [ ] Sound parameters per drum / lead (encoder without modifier)
- [ ] MIDI out per track
