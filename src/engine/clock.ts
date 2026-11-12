// Sequencer clock: lookahead scheduler ("A Tale of Two Clocks").
// A worker ticks every `tick` ms; each tick hands out all steps due within the next `lookahead` ms, with their exact
// time. Consumers schedule at that time: audio via toAudioTime() (./audio.ts), MIDI via send(data, time),
// lights/UI via clock.at(time, fn).
//
// Timebase: performance.now() ms. It runs without a user gesture (AudioContext doesn't), Web MIDI uses it natively,
// and audio converts per event, so there is no drift to accumulate.
// The tick runs in a worker: main-thread timers in hidden tabs are throttled to 1 Hz (and to 1/min after 5 min).

export interface ClockStep {
    /** Running step counter, from the start() index on. */
    index: number;
    /** When the step plays, performance.now() ms (swing included). */
    time: number;
    /** Step length in ms at the current tempo (without swing). */
    duration: number;
}

export interface ClockOptions {
    bpm?: number;
    /** 50 = straight, 66 ≈ triplet feel, 75 = max. The 2nd step of every pair is delayed (MPC-style). */
    swing?: number;
    /** Steps per quarter note (4 = 16ths). */
    stepsPerBeat?: number;
    /** How far ahead steps are handed out, ms. Must be longer than the worst tick delay. */
    lookahead?: number;
    /** Scheduler tick, ms. */
    tick?: number;
}

type StepListener = (step: ClockStep) => void;

const TICKER_SOURCE = `let id = null;
onmessage = (e) => { clearInterval(id); id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null; };`;

export class Clock {
    bpm: number;
    swing: number;
    stepsPerBeat: number;
    lookahead: number;
    tick: number;

    /** Index passed to the last start(). */
    startIndex = 0;

    private listeners = new Set<StepListener>();
    private worker: Worker | null = null;
    private nextIndex = 0;
    /** Grid time of the next step, without swing. */
    private nextGrid = 0;
    private timers = new Set<ReturnType<typeof setTimeout>>();

    constructor({ bpm = 120, swing = 50, stepsPerBeat = 4, lookahead = 100, tick = 25 }: ClockOptions = {}) {
        this.bpm = bpm;
        this.swing = swing;
        this.stepsPerBeat = stepsPerBeat;
        this.lookahead = lookahead;
        this.tick = tick;
    }

    get running(): boolean {
        return this.worker !== null;
    }

    /** Step length in ms at the current tempo. */
    get stepDuration(): number {
        return 60000 / this.bpm / this.stepsPerBeat;
    }

    /** Called ahead of time for every step. Returns an unsubscribe function. */
    onStep(listener: StepListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Starts at step `index` (default 0), `delay` ms from now (default: one lookahead, leaves room for startup work).
     * Resume after a pause with the next index, so swing stays on the same steps.
     */
    start(index = 0, delay = this.lookahead): void {
        this.stop();
        this.startIndex = index;
        this.nextIndex = index;
        this.nextGrid = performance.now() + delay;
        const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = () => this.schedule();
        this.worker.postMessage(this.tick);
        this.schedule();
    }

    /** Stops the clock and cancels pending at() callbacks. */
    stop(): void {
        this.worker?.terminate();
        this.worker = null;
        for (const t of this.timers) clearTimeout(t);
        this.timers.clear();
    }

    /** Runs fn at `time` (performance.now() ms), for lights / UI. Main-thread timer: ~1 ms late, throttled in hidden tabs. */
    at(time: number, fn: () => void): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            fn();
        }, Math.max(0, time - performance.now()));
        this.timers.add(timer);
    }

    private schedule(): void {
        const horizon = performance.now() + this.lookahead;
        while (this.worker && this.nextGrid < horizon) {
            const duration = this.stepDuration;
            const swing = Math.min(75, Math.max(50, this.swing)) / 100;
            const offset = this.nextIndex % 2 === 1 ? (2 * swing - 1) * duration : 0;
            const step: ClockStep = { index: this.nextIndex, time: this.nextGrid + offset, duration };
            this.nextIndex++;
            this.nextGrid += duration; // tempo changes apply from the next step on
            for (const listener of this.listeners) {
                try {
                    listener(step);
                } catch (error) {
                    console.error('clock listener failed:', error);
                }
            }
        }
    }
}
