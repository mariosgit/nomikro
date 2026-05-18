import { MaschineMikroMk3 } from './maschine_mikro_mk3';

export class Screen {
    private device: MaschineMikroMk3;

    constructor(device: MaschineMikroMk3) {
        this.device = device;
    }

    async set(text: string, size: number = 14): Promise<void> {
        const imgData = this.getBitImg(text, size);
        const buf = this.getBuffer(imgData);
        await this.writeBuf(buf);
    }

    private getBitImg(text: string, size: number): ImageData {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 128, 32);
        ctx.fillStyle = 'white';
        ctx.font = `${size}px monospace`;
        const lines = text.split('\n');
        ctx.fillText(lines[0] || '', 0, 16);
        ctx.fillText(lines[1] || '', 0, 32);
        return ctx.getImageData(0, 0, 128, 32);
    }

    private getBuffer(img: ImageData): number[] {
        const buf: number[] = new Array(512).fill(0xFF);
        for (let i = 0; i < 128; i++) {
            for (let line = 0; line < 4; line++) {
                let byteVal = 0x00;
                for (let bit = 0; bit < 8; bit++) {
                    byteVal <<= 1;
                    const pixIndex = ((8 * line + (7 - bit)) * 128 + i) * 4;
                    const pixVal = img.data[pixIndex]; // assuming grayscale
                    if (pixVal < 128) { // black pixel
                        byteVal += 1;
                    }
                }
                buf[128 * line + i] = byteVal;
            }
        }
        return buf;
    }

    private async writeBuf(buf: number[]): Promise<void> {
        const headerHi = [0xE0, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x02, 0x00];
        const headerLo = [0xE0, 0x00, 0x00, 0x02, 0x00, 0x80, 0x00, 0x02, 0x00];
        await this.device.write(headerHi.concat(buf.slice(0, 256)));
        await this.device.write(headerLo.concat(buf.slice(256)));
    }
}