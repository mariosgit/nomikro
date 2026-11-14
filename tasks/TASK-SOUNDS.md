# TASK Sounds

Sound engines and sound sources for μOp (`src/engine/instruments/`). Engines sit behind the `Melodic` / `DrumKit`
contract, so SEARCH / STAR / PLUG-IN page select work as is. Moved here from [TASK-MüOperator.md](TASK-MüOperator.md).

## Open

- [ ] PLUG-IN page: strip = macro / morph.
- [ ] Sound tuning: rework the sounds that feel weak (needs listening feedback, `src/engine/instruments/`).
- [ ] More engines: samples (drum kits as WAV/OGG one-shots), smplr, Faust / AudioWorklet.
- [ ] Keep it simple? Plug in an FM1 and do the MIDI thing (MIDI out + audio inputs work now); MIDI / audio routing
  presets for your fav synth (app only, see [TASK-MüOperator.md](TASK-MüOperator.md) section 1).
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

## Plugins (VST / AU)

Chrome can't load VST / AU plugins: Web Audio only runs JS + WebAssembly in the sandbox, no native binaries.

- [ ] **Web plugins as an engine: Web Audio Modules (WAM 2).** The web's plugin standard (AudioWorklet + WASM, with
  parameters, MIDI, presets); catalog of open-source WAMs (synths, FX, amps). One `wam` engine behind the
  `Melodic` / `DrumKit` contract, the WAM's parameters on the PLUG-IN page. Preferred route for in-app plugins.
  - Related: iPlug2 builds the same plugin as VST / AU / WAM; JUCE has no official web target (community experiments
    only); Faust compiles to an AudioWorklet directly (see "More engines"). Commercial plugins (Serum, Diva, …) have no
    web builds: open-source / web-native sounds only.
- [ ] **Native plugins via a bridge** (works with the current app, docs / setup guide only):
  μOp MIDI out → macOS **IAC Driver** (virtual MIDI port, Audio MIDI Setup) → a plugin host (Element, Carla,
  Gig Performer, Hosting AU, Logic / GarageBand) plays any VST / AU → back in via **BlackHole** (virtual audio cable)
  on μOp's audio inputs, or straight to the speakers. Costs: a second app, latency (see the input latency
  compensation in [TASK-MüOperator.md](TASK-MüOperator.md) section 1). Could share the routing presets with the FM1 item.
- [ ] Porting other open-source DSP the same way as Mutable Instruments (C++ → WASM → AudioWorklet), where the license
  allows it.

## Later

- Keep the "(edited)" browser entry across reloads (store it in the song).
