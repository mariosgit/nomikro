# Nomikro

Control a **Maschine Mikro MK3** from a web app
via **WebHID** (TypeScript, Vite, React ...).

Port of [Pymikro](#pymikro) to the browser.

The name? Uhh that evolved no-py and mikro... so what...

## Try It !

[goto MüOp](https://mariosgit.github.io/nomikro/) use chome/chromium !

| | |
|---|---|
| If you like this sort of content or if its been even usefull to you, feel free motivating me publishing such stuff. | <a href="https://www.buymeacoffee.com/mariosgeu" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="32" width="128"></a> |
|||

## Get started

```
npm i
npm run dev
```

Open `localhost:9000` in a Chromium-based desktop browser: Chrome, Edge, Brave, Opera, Chromium (WebHID, version 89+; only works on localhost or behind https). Safari, Firefox and iOS browsers have no WebHID: the page shows a notice instead of the Connect button.
On Linux, allow access to the device: `sudo cp 50-ni-maschine.rules /etc/udev/rules.d/` and re-plug.

- `localhost:9000`: the app; pick an app in the header (`#/lab`: light show + hardware tests, `#/starter`: template)
- `localhost:9000/examples/minimal/`: a minimal example without a framework

`npm run build` builds all pages to `dist/`.

### GitHub Pages

Every push to `main` builds the site and deploys it to `https://<user>.github.io/<repo>/`
(see [`.github/workflows/pages.yml`](.github/workflows/pages.yml)). One-time setup in the GitHub repo:
**Settings → Pages → Build and deployment → Source: GitHub Actions**. Pages is https, so WebHID works there.

## Structure

```
src/
  maschine/        the driver: WebHID, lights, screen, pads, buttons/encoder/strip. Framework-free, no app code.
                   Public API in index.ts, docs in src/maschine/README.md
  shell/           the React frame: connect, header (app switcher), routing #/<app>/<path>?<params>, device runner
  apps/            one folder per idea / app version, registered in apps/index.ts
    lab/           light show + hardware test modes
    starter/       template for a new app
    muop/          μOp: PO-style groovebox (16 tracks, 16 patterns, chains, punch-in FX)
  engine/          music engine, framework-free: clock (lookahead scheduler), audio timing, metronome,
                   instruments/ (sound engines per track: basic Web Audio, Tone.js)
  dev/             dev-only helpers (log to the dev server)
examples/
  minimal/         ~50 lines: connect, pads/buttons/strip/encoder → lights + screen
vite-plugins/      dev server helpers (full reload on change, hw-bridge for testing)
```

## Build your own

- **Own app, any framework (or none):** copy `examples/minimal`, import from `src/maschine`, and add the page to
  `build.rollupOptions.input` in `vite.config.ts`. Read [`src/maschine/README.md`](src/maschine/README.md).
- **A new idea / app version:** copy `src/apps/starter/` to `src/apps/<name>/`, rename the export and add it to
  `src/apps/index.ts`. It shows up in the header at `#/<name>`. The app is a React component (`AppProps` in
  `src/shell/types.ts`) and drives the device with `useDeviceTask()` (`src/shell/device.ts`), which hands the device
  over cleanly when you switch apps.
- **A new lab mode:** write `run(maschine, signal, ctx)` (see `src/apps/lab/modes/types.ts`), and register it
  in `src/apps/lab/modes/index.ts`. It shows up as a button in the lab.
- **Elsewhere:** `src/maschine` has no dependencies; copy the folder.

Only one page should drive the device at a time (two tabs both write to it).

---

## About

### Supported hardware features

Overall, there is actually more feature than the manufacturer uses :)

Pads:

- Set color (17 possible values) and intensity
- Get pressure value
- Info whether pressed, touched, or released

Buttons:

- get buttons being pressed
- set light brightness

Encoder:

- get value of the encoder (1 byte), and how much it moved
- whether it's being touched (not pressed)

Touch strip:

- get position of up to 2 fingers
- set color and brightness of each LED

Screen:

- set text with adjustable size, on 1 or 2 lines

## Credits

### flokapi

This project started as a fork of [pymikro](https://github.com/flokapi/pymikro) by [flokapi](https://github.com/flokapi),
a Python library for the Maschine Mikro MK3. The HID protocol (report layouts for lights, screen, pads and buttons)
comes from their work. Thank you!

Nomikro ports it to TypeScript/WebHID for the browser, verifies the details against the hardware, and adds the web app.

### tone.js

Used as sound engine. Cool stuff.

### Mutable Instruments Marbles

μOp's VARIATION (random patterns with a "déjà vu" control that dials in how much a pattern changes) is inspired by
[Marbles](https://pichenettes.github.io/mutable-instruments-documentation/modules/marbles/) by Émilie Gillet /
Mutable Instruments ([source](https://github.com/pichenettes/eurorack), MIT). Own implementation for a step sequencer
(`src/apps/muop/variation.ts`), no code copied. Mutable Instruments and Marbles are names of their respective owners.

### Chorder

The "likely next chord" suggestions in μOp follow the idea of Floyd Steinberg's
[Chorder](https://www.floydsteinberg.com/extension/www.floydsteinberg.com/webmidi/chorder/chorder.html) (own implementation).

### claude

The AI agent helped a bit to rewrite all of the python code and everything else.
Supervised by humans :-P
