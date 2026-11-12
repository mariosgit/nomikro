// Minimal use of the driver (src/maschine), no framework. Start your own app from here.
import { LED_BUTTONS, STRIP_LEDS, STRIP_MAX, connect, type MaschineMikroMk3 } from '../../src/maschine';

const button = document.querySelector<HTMLButtonElement>('#connect')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

function start(m: MaschineMikroMk3) {
    status.textContent = 'Connected. Play!';
    button.hidden = true;

    let encoder = 0;
    m.lights.clear();
    m.lights.flush();
    m.screen.set('Minimal\nexample');

    m.setPadCallback((pad) => {
        if (pad.pressed) m.lights.pad(pad.pad_nb, 'blue');
        else if (pad.released) m.lights.pad(pad.pad_nb, 'off');
        else return; // pressure updates
        m.lights.flush(); // sends once, coalesces with other changes
    });

    m.setButtonCallback((b) => {
        for (const name of LED_BUTTONS) m.lights.button(name, b.btn_pressed.includes(name) ? 4 : 0);
        for (let i = 0; i < STRIP_LEDS; i++) m.lights.strip(i, 'off');
        if (b.strip_pos_1) m.lights.strip(Math.round(((b.strip_pos_1 - 1) / (STRIP_MAX - 1)) * (STRIP_LEDS - 1)), 'cyan');
        m.lights.flush();

        if (b.encoder_move) {
            encoder += b.encoder_move;
            m.screen.set(`Encoder\n${encoder}`);
        }
    });
}

// Reuse an already permitted device (works on page load), otherwise ask on click (needs a user gesture).
connect().then((m) => {
    if (m) start(m);
    else {
        status.textContent = 'Not connected yet.';
        button.hidden = false;
    }
});
button.onclick = async () => {
    const m = await connect({ prompt: true });
    if (m) start(m);
};
