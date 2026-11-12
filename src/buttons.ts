
export class Buttons {
    button_order: string[];
    last_encoder_pos: number | null;

    constructor(button_order_: string[]) {
        this.button_order = button_order_;
        this.last_encoder_pos = null;
    }

    private _get_pressed_btns(raw_cmd: number[]): { btn_pressed: string[] } {

        let btn_val = 0n; // BigInt
        for (let i = 0; i < 6; i++) {
            btn_val |= (BigInt(raw_cmd[i]) << BigInt(i * 8));
        }

        // This is just a bit per button ! But there are 37 buttons, so it fits in 5 bytes (40 bits)
        console.log(btn_val.toString(16));

        const btns: string[] = [];
        for (let btn_index = 0; btn_index < this.button_order.length; btn_index++) {
            const bitMask = 1n << BigInt(btn_index);
            if ((btn_val & bitMask) !== 0n) {
                btns.push(this.button_order[btn_index]);
            }
        }

        return { btn_pressed: btns };
    }

    private _get_encoder_info(raw_cmd: number[]): { encoder_pos: number; encoder_move: number; encoder_touched: boolean } {
        const encoder_pos = raw_cmd[7];
        let encoder_move = 0;
        
        if (this.last_encoder_pos !== null) {
            const diff = encoder_pos - this.last_encoder_pos;
            if (Math.abs(diff - 16) < Math.abs(diff)) {
                encoder_move = diff - 16;
            } else if (Math.abs(diff + 16) < Math.abs(diff)) {
                encoder_move = diff + 16;
            } else {
                encoder_move = diff;
            }
        }
        
        this.last_encoder_pos = encoder_pos;

        return {
            encoder_pos: encoder_pos,
            encoder_move: encoder_move,
            encoder_touched: raw_cmd[6] === 1
        };
    }

    private _get_strip_value(raw_cmd: number[]): { strip_pos_1: number; strip_pos_2: number } {
        return {
            strip_pos_1: raw_cmd[10],
            strip_pos_2: raw_cmd[12]
        };
        // Note: strip_time is commented out in original
        // strip_time: raw_cmd[9] * 256 + raw_cmd[8]
    }

    decode(raw_cmd: number[]): { cmd: string; btn_pressed: string[]; encoder_pos: number; encoder_move: number; encoder_touched: boolean; strip_pos_1: number; strip_pos_2: number } | null {
        // console.log('Decoding button command from raw data:', raw_cmd);
        if (raw_cmd.length === 13) {
            const ret: any = { cmd: "btn" };

            Object.assign(ret, this._get_pressed_btns(raw_cmd));
            Object.assign(ret, this._get_encoder_info(raw_cmd));
            Object.assign(ret, this._get_strip_value(raw_cmd));

            return ret;
        }

        return null;
    }
}
