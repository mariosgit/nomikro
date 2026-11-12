# Maschine-PiMicro

Browser app (Vite + React + TypeScript) that drives a Native Instruments **Maschine Mikro MK3** over **WebHID**.
The device sits on the desk in front of a webcam (`/dev/video0`), so changes can be checked visually.

- `src/maschine_mikro_mk3.ts` device class (HID open/write, input report decoding)
- `src/lights.ts` LED state → 0x80 report, `src/screen.ts` 128×32 display, `src/buttons.ts` / `src/pads.ts` input decoding
- `src/maschine_mikro_mk3.json` vid/pid, button + pad order, color names
- `src/lightshow.ts` animated scenes (`SCENES`), `runLightShow(maschine, signal)`
- `src/App.tsx` connects and starts the light show automatically
- `src-py-old/` the original Python implementation (pymikro), reference only

## Rules

- **Drive the device only through the browser app.** No Node/hidraw/Python shortcuts that write to `/dev/hidraw*`.
  The point is to build and verify the WebHID app itself.

## Dev loop

1. The dev server is usually already running (`npm start` → http://localhost:9000, Chrome/Chromium for WebHID).
   Check before starting another one: `ss -ltnp | grep 9000`.
2. Edit code. `vite.config.ts` forces a **full page reload** on every change (no HMR, which would leave stale HID
   handles and loops running). After the reload the app auto-connects via `navigator.hid.getDevices()` and starts the show.
   - Auto-connect only works once permission was granted via the "Connect to Device" button (user gesture, the user has to click it).
   - The tab must stay visible: background tabs throttle timers to ~1 Hz, so animations crawl.
3. Type-check: `npx tsc` (`npm run build` = tsc + vite build).
4. Look at the device with the camera (below). Don't claim a visual change works without a shot.

## Camera feedback

Single shot (creates `shot001.jpg`; skips 15 frames so exposure settles):

```
ffmpeg -f v4l2 -i /dev/video0 -vf "select=gte(n\,15)" -frames:v 1 shot%03d.jpg
```

Time series as one contact sheet: one frame every 4 s over 36 s (= one light show cycle), tiled 3×3:

```
ffmpeg -f v4l2 -i /dev/video0 -vf "fps=1/4,scale=480:-1" -frames:v 9 seq%02d.jpg
ffmpeg -i seq%02d.jpg -vf "tile=3x3" -frames:v 1 contact.jpg
```

- Put shots in the scratchpad, not the repo.
- **Bright LEDs blow out to white** with auto exposure (colors become indistinguishable). Lock exposure for color checks,
  then restore the user's settings:
  ```
  v4l2-ctl -d /dev/video0 -c auto_exposure=1 -c exposure_time_absolute=15 -c gain=40   # manual
  v4l2-ctl -d /dev/video0 -c auto_exposure=3 -c gain=222                               # restore (aperture priority)
  ```
- Rolling shutter: fast strobes can show up half lit (top rows on, bottom off). That's the camera, not a bug.

## Hardware notes (verified on camera)

- Pads: number 0–15, pad 0 = bottom left (printed label "1"), pad 12 = top left. Row-major from the bottom.
- Touch strip: 25 LEDs (`strip` 0–24; direction assumed left → right, not yet verified).
- Pad/strip brightness `val` 1–3 (0 = off); byte = 4 × colorIndex + val, so `val` 4 bleeds into the next color.
- Buttons: brightness 0–4, no color. `enc-push` / `enc-touched` have no LED; their indexes land on pad LEDs, so skip them.
- Display shows the current scene name (`maschine.screen.set`), auto-blanks after 3 s.
