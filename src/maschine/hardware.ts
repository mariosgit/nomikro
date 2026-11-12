// Maschine Mikro MK3 hardware constants (was maschine_mikro_mk3.json; TS `as const` gives literal types).

export const VENDOR_ID = 0x17cc;
export const PRODUCT_ID = 0x1700;

/** Bit order of the buttons in the input report (0x01). */
export const BUTTONS = [
    'project', 'star', 'search', 'volume', 'swing', 'tempo', 'plug_in', 'sampling',
    'arrow_left', 'arrow_right', 'pitch', 'mod', 'perfrom', 'notes', 'group', 'auto',
    'lock', 'note_repeat', 'restart', 'erase', 'tap', 'follow', 'play', 'rec',
    'stop', 'shift', 'fixed_vel', 'pad_mode', 'keyboard', 'chords', 'step', 'scene',
    'pattern', 'events', 'variation', 'duplicate', 'select', 'solo', 'mute',
    'enc-push', 'enc-touched',
] as const;
export type Button = (typeof BUTTONS)[number];

/** Buttons with an LED, in lights report order (same as the input order, minus the encoder). */
export type LedButton = Exclude<Button, 'enc-push' | 'enc-touched'>;
export const LED_BUTTONS = BUTTONS.filter((b): b is LedButton => b !== 'enc-push' && b !== 'enc-touched');

/** Hardware slot (input report and LED report) -> pad number. Pad 0 = bottom left (printed "1"). */
export const PAD_ORDER = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3] as const;
export const PAD_COUNT = 16;
export const STRIP_LEDS = 25;
/** Touch strip position range (button report byte 9): 1..200 left → right, 0 = not touched. Checked by hand. */
export const STRIP_MAX = 200;

/**
 * Color index n -> LED byte 4·n + level. 'off' (index 0) is always byte 0.
 * Raw level 0 is NOT off (dim, ≈ level 1, checked on camera); Lights uses byte 0 for off and levels 1..3.
 */
export const COLORS = [
    'off', 'red', 'orange', 'orange_light', 'yellow_warm', 'yellow', 'lime', 'green', 'mint',
    'cyan', 'turquoise', 'blue', 'plum', 'violet', 'purple', 'magenta', 'fuchsia', 'white',
] as const;
export type Color = (typeof COLORS)[number];

/**
 * Button level 0..4 -> LED byte. Checked on camera (single-color buttons): bytes 0..3 and ≥128 are off,
 * otherwise only the low 2 bits matter, with brightness order 0b01 < 0b00 < 0b10 < 0b11.
 * So 13, 12, 10, 11 = 0b01, 0b00, 0b10, 0b11: odd-looking, but monotonic.
 */
export const BUTTON_BRIGHTNESS = [0, 13, 12, 10, 11] as const;
