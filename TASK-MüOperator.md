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
- [ ] Sound tuning: rework the drum sounds that feel weak (needs listening feedback, `sounds.ts`)
- [ ] Bass track: second melodic track. KEYBOARD toggles between "lead" and "bass" (pressing it again switches),
  own sound (mono, low octave), own steps per pattern. Display / page show which one is selected.
- [ ] Chords track: CHORDS button selects it. Pads = 16 chords (PO-20 style, e.g. diatonic chords of the scale +
  inversions / sus), steps hold a chord, own pad-like sound.
- [ ] MUTE / SOLO per drum sound
- [ ] Per-step parameter locks (hold step + encoder for drums: pitch / decay)
- [ ] Sound parameters per drum / lead (encoder without modifier)
- [ ] MIDI out per track
