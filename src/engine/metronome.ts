// Metronome: a click on every beat (accent on the bar), driven by a Clock. Shared by all apps:
// the on/off setting is stored in the browser and carries over between apps. Convention: SHIFT + TAP toggles it.
import { audioContext, toAudioTime } from './audio';
import type { Clock } from './clock';

const KEY = 'metronome/enabled';

function load(): boolean {
    try {
        return localStorage.getItem(KEY) === '1';
    } catch {
        return false;
    }
}

export class Metronome {
    enabled = load();
    beatsPerBar = 4;

    /** Toggles and stores the setting. Returns the new state. */
    toggle(): boolean {
        this.enabled = !this.enabled;
        try {
            localStorage.setItem(KEY, this.enabled ? '1' : '0');
        } catch {
            // storage blocked: works for this session
        }
        return this.enabled;
    }

    /** Clicks along with the clock (step index 0 = bar start). Returns an unsubscribe function. */
    attach(clock: Clock): () => void {
        return clock.onStep(({ index, time }) => {
            if (!this.enabled || index % clock.stepsPerBeat !== 0) return;
            this.click(time, index % (clock.stepsPerBeat * this.beatsPerBar) === 0);
        });
    }

    /** One click at `time` (performance.now() ms). Goes straight to the output, past any app effects. */
    click(time: number, accent: boolean): void {
        const ctx = audioContext();
        if (ctx.state !== 'running') return;
        const t = toAudioTime(time);
        const osc = new OscillatorNode(ctx, { type: 'square', frequency: accent ? 1600 : 1000 });
        const amp = new GainNode(ctx, { gain: 0 });
        amp.gain.setValueAtTime(accent ? 0.15 : 0.08, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        osc.connect(amp).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.04);
    }
}
