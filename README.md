# Nomikro

Port of [Pymikro](#pymikro) to the browser: control a **Maschine Mikro MK3** from a web app
via **WebHID** (TypeScript, Vite, React ...).

## Get started

```
npm i
npm run dev
```

Open `localhost:9000` in Chrome/Chromium (WebHID; only works on localhost or behind https).
On Linux, allow access to the device: `sudo cp 50-ni-maschine.rules /etc/udev/rules.d/` and re-plug.

- `localhost:9000`: the app (light show + hardware test modes)
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
  app/             the React demo app
    modes/         one mode = one thing the app does with the device (light show, tests, …)
  dev/             dev-only helpers (log to the dev server)
examples/
  minimal/         ~50 lines: connect, pads/buttons/strip/encoder → lights + screen
vite-plugins/      dev server helpers (full reload on change, hw-bridge for testing)
```

## Build your own

- **Own app, any framework (or none):** copy `examples/minimal`, import from `src/maschine`, and add the page to
  `build.rollupOptions.input` in `vite.config.ts`. Read [`src/maschine/README.md`](src/maschine/README.md).
- **A new mode in the demo app:** write `run(maschine, signal, ctx)` (see `src/app/modes/types.ts`), and register it
  in `src/app/modes/index.ts`. It shows up as a button.
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

This project started as a fork of [pymikro](https://github.com/flokapi/pymikro) by [flokapi](https://github.com/flokapi),
a Python library for the Maschine Mikro MK3. The HID protocol (report layouts for lights, screen, pads and buttons)
comes from their work. Thank you!

Nomikro ports it to TypeScript/WebHID for the browser, verifies the details against the hardware, and adds the web app.
