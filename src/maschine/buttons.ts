/**
 * Button report (0x01), 13 data bytes (checked against raw reports, the Python version had the report id at index 0):
 *   0..5   button bits, bit i = order[i] (incl. enc-push bit 39, enc-touched bit 40)
 *   6      encoder position 0..15 (wraps)
 *   7..8   timestamp, little endian (ms, +25 per report while the strip is touched)
 *   9      touch strip position (0 = not touched)
 *   11     touch strip, 2nd value (2nd finger?)
 */
export interface ButtonState {
    cmd: 'btn';
    btn_pressed: string[];
    encoder_pos: number;
    /** Steps since the previous report, wrap-around handled (±). */
    encoder_move: number;
    encoder_touched: boolean;
    strip_pos_1: number;
    strip_pos_2: number;
    time: number;
}

export class Buttons {
    private last_encoder_pos: number | null = null;

    constructor(private button_order: readonly string[]) {}

    decode(raw: ArrayLike<number>): ButtonState | null {
        if (raw.length !== 13) return null;

        const btn_pressed = this.button_order.filter((_, i) => (raw[i >> 3] & (1 << (i & 7))) !== 0);

        const encoder_pos = raw[6] & 0x0f;
        let encoder_move = 0;
        if (this.last_encoder_pos !== null) {
            const diff = encoder_pos - this.last_encoder_pos;
            encoder_move = ((diff + 8 + 16) % 16) - 8; // shortest way around the 16 positions
        }
        this.last_encoder_pos = encoder_pos;

        return {
            cmd: 'btn',
            btn_pressed,
            encoder_pos,
            encoder_move,
            encoder_touched: btn_pressed.includes('enc-touched'),
            strip_pos_1: raw[9],
            strip_pos_2: raw[11],
            time: raw[7] | (raw[8] << 8),
        };
    }
}
