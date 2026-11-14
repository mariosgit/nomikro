// Maschine Mikro MK3 driver for the browser (WebHID). Framework-free: no React, no app code.
// See ./README.md for usage.
export { MaschineMikroMk3, Priority } from './device';
export type { PadEvent } from './pads';
export type { ButtonState } from './buttons';
export type { Lights, LightLayer } from './lights';
export type { Screen, Draw } from './screen';
export type { Input, InputEvent, InputEventType, InputEventOf, PadSensitivity } from './input';
export {
    VENDOR_ID,
    PRODUCT_ID,
    BUTTONS,
    LED_BUTTONS,
    PAD_ORDER,
    PAD_COUNT,
    STRIP_LEDS,
    STRIP_MAX,
    COLORS,
    BUTTON_BRIGHTNESS,
    type Button,
    type LedButton,
    type Color,
} from './hardware';

import { MaschineMikroMk3 } from './device';
import { PRODUCT_ID, VENDOR_ID } from './hardware';

/** WebHID filter for navigator.hid.requestDevice(). */
export const HID_FILTER: HIDDeviceFilter = { vendorId: VENDOR_ID, productId: PRODUCT_ID };

export const isMaschineMikroMk3 = (device: HIDDevice) => device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID;

/**
 * Opens the controller: an already permitted device if there is one, otherwise (when `prompt` is set) shows the
 * browser's device picker, which needs a user gesture (call it from a click handler). Returns null if none was chosen.
 */
export async function connect({ prompt = false } = {}): Promise<MaschineMikroMk3 | null> {
    let device = (await navigator.hid.getDevices()).find(isMaschineMikroMk3);
    if (!device && prompt) [device] = await navigator.hid.requestDevice({ filters: [HID_FILTER] });
    if (!device) return null;
    const maschine = new MaschineMikroMk3();
    await maschine.openDevice(device);
    return maschine;
}
