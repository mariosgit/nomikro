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
- [ ] PERFORM + pad: punch-in FX (stutter / retrigger, filter sweeps, glitch), next up
- [x] Sound engine per track: `src/engine/instruments/` (basic, Tone.js), page select or SEARCH,
  stored in the song per track.
- [x] SEARCH = next sound for the current track (SHIFT = previous), STAR = random variation (temporary, not saved),
  VOLUME + encoder = track volume (saved in the song), SHIFT + VOLUME = master. Engines take a `random` flag (`chooser()`).
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
- [ ] MUTE / SOLO + pad: per track (pads show the tracks like SELECT), per drum sound on a drums track
- [ ] Per-step parameter locks (hold step + encoder for drums: pitch / decay)
- [ ] Sound parameters per drum / lead (encoder without modifier)
- [ ] MIDI out per track
