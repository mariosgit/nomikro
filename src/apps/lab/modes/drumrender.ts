// Lab mode 'drum-render': plays drum hits (the lambada's kick / snare steps) through a real drum kit and checks the
// output, without the device, the mixer or a capture chain:
// - offline (default): renders a, b and both in an OfflineAudioContext. Logs peak, biggest sample jump and
//   "both − (a + b)" (the graph is linear at drive 0, so any difference = the sounds interfering).
// - live=a|b|both: plays them on the app's AudioContext (to the speakers) and records the graph output inside the
//   graph (AudioWorklet, sample exact, no device / capture glitches). Then renders the same calls offline at the
//   same times with the same random numbers and compares: Tone is deterministic, so a difference = something only
//   live playback does (timers, "now"-based scheduling). sched=lookahead (like the sequencer) | upfront.
// - live=sine: a steady 110 Hz sine (for checking a capture chain outside the browser).
// Params: kit=tone|basic, bpm=115, bars=4, a=0 b=1 (drum sounds), drive=0..1 (all drum sounds).
import { audioContext } from '../../../engine/audio';
import { DRUM_KITS, findInstrument, type DrumKit, type Params } from '../../../engine/instruments';
import { activeProject, loadProject } from '../../muop/projects';
import { Sounds } from '../../muop/sounds';
import { untilAborted, type Mode } from './types';

/** The lambada's kick / snare steps (src/apps/muop/lambada.ts): [step, velocity]. Other sounds play the snare steps. */
const HITS: Record<number, [number, number][]> = {
    0: [[0, 1], [3, 0.75], [6, 0.6], [8, 1], [11, 0.75], [14, 0.6]],
    1: [[4, 0.8], [12, 0.85], [7, 0.25], [15, 0.3]],
};

interface Hit {
    sound: number;
    /** Seconds from the start of the pattern. */
    at: number;
    v: number;
}

const hits = (sounds: number[], bpm: number, bars: number): Hit[] => {
    const step = 60 / bpm / 4;
    const list = Array.from({ length: bars }, (_, bar) => sounds.flatMap((sound) => (HITS[sound] ?? HITS[1]).map(([s, v]) => ({ sound, at: (bar * 16 + s) * step, v })))).flat();
    return list.sort((x, y) => x.at - y.at || x.sound - y.sound);
};
const lengthOf = (bpm: number, bars: number) => (bars * 16 * 60) / bpm / 4 + 0.6;

/** A deterministic Math.random, installed only around the calls (noise sources start at random offsets). */
function rng() {
    let s = 12345;
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    return <T>(fn: () => T): T => {
        const orig = Math.random;
        Math.random = next;
        try {
            return fn();
        } finally {
            Math.random = orig;
        }
    };
}

async function makeKit(ctx: BaseAudioContext, kitId: string, out: AudioNode, params: Params): Promise<DrumKit> {
    const def = findInstrument(DRUM_KITS, kitId);
    if (def.id === 'tone') (await import('tone')).setContext(ctx as AudioContext); // Tone makes its nodes on its current context
    return def.create(ctx as AudioContext, out, params);
}

/** A point in μOp's mixer chain to record (`tap=`): track gain → filter → highpass → fx → master → limiter. */
function tapNode(sounds: Sounds, tap: string): AudioNode {
    const x = sounds as unknown as { slots: Map<number, { gain: AudioNode; drive: { input: AudioNode } }>; filter: AudioNode; highpass: AudioNode; fx: Record<string, AudioNode>; master: AudioNode; limiter: AudioNode };
    if (tap.startsWith('fx.')) return x.fx[tap.slice(3)]; // fx.hp, fx.lp, fx.tapeLp, fx.crushDry, fx.crushWet, fx.gate
    switch (tap) {
        case 'track': return x.slots.get(0)!.gain;
        case 'filter': return x.filter;
        case 'highpass': return x.highpass;
        case 'fx': return x.fx.output;
        case 'master': return x.master;
        default: return x.limiter;
    }
}

/** Offline render: hit k at `lead + at` seconds. */
async function render(kitId: string, list: Hit[], seconds: number, lead: number, params: Params, rate: number, chain = '', tap = ''): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, Math.ceil((lead + seconds) * rate), rate);
    try {
        let kit: DrumKit;
        if (chain === 'muop') {
            // μOp's mixer, as in playLive()
            (await import('tone')).setContext(ctx as unknown as AudioContext);
            const sounds = new Sounds(ctx as unknown as AudioContext);
            const song = loadProject(activeProject().id);
            const track = song.tracks.find((t) => t.kind === 'drums');
            await sounds.set(0, 'drums', kitId, params);
            sounds.setLevel(0, track?.level ?? 1);
            sounds.volume = song.volume;
            // record at the tap: cut the limiter from the destination, route the tap there instead
            const x = sounds as unknown as { limiter: AudioNode };
            x.limiter.disconnect();
            tapNode(sounds, tap).connect(ctx.destination);
            kit = { trigger: (sound, t, v) => sounds.drum(0, sound, t, v), dispose: () => {} };
        } else kit = await makeKit(ctx, kitId, ctx.destination, params);
        const seeded = rng();
        for (const h of list) seeded(() => kit.trigger(h.sound, lead + h.at, h.v));
        return (await ctx.startRendering()).getChannelData(0);
    } finally {
        (await import('tone')).setContext(audioContext()); // back to the app's context
    }
}

const RECORDER = `
class Rec extends AudioWorkletProcessor {
    constructor() { super(); this.first = -1; this.on = true; this.port.onmessage = () => (this.on = false); }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (this.first < 0) this.first = currentFrame;
        if (ch) this.port.postMessage({ frame: currentFrame, data: ch.slice() });
        else this.port.postMessage({ frame: currentFrame, data: new Float32Array(128) });
        return this.on;
    }
}
registerProcessor('drum-render-rec', Rec);`;
let recorderLoaded: Promise<void> | null = null;

/**
 * Live: plays the hits on the app's AudioContext from t0 (sched: lookahead like the sequencer, or all at once) and
 * records the kit's output in the graph. Returns the recording and the time of its first sample.
 */
async function playLive(kitId: string, list: Hit[], seconds: number, params: Params, sched: string, signal: AbortSignal, chain = '', tap = '') {
    const ctx = audioContext();
    recorderLoaded ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: 'text/javascript' })));
    await recorderLoaded;
    const rec = new AudioWorkletNode(ctx, 'drum-render-rec', { channelCount: 1, channelCountMode: 'explicit' });
    const mute = new GainNode(ctx, { gain: 0 });
    rec.connect(mute).connect(ctx.destination); // keeps it pulled
    const bus = new GainNode(ctx);
    bus.connect(ctx.destination);
    bus.connect(rec);
    const chunks: { frame: number; data: Float32Array }[] = [];
    rec.port.onmessage = (e) => chunks.push(e.data);

    let kit: DrumKit;
    let sounds: Sounds | null = null;
    if (chain === 'muop') {
        // μOp's mixer: track drive → track gain → DJ filter → FX bus → master → limiter → speakers; tapped after the limiter
        sounds = new Sounds(ctx);
        const song = loadProject(activeProject().id);
        const track = song.tracks.find((t) => t.kind === 'drums');
        await sounds.set(0, 'drums', kitId, params);
        sounds.setLevel(0, track?.level ?? 1);
        sounds.volume = song.volume;
        tapNode(sounds, tap).connect(rec);
        const s = sounds;
        kit = { trigger: (sound, t, v) => s.drum(0, sound, t, v), dispose: () => s.dispose() };
    } else kit = await makeKit(ctx, kitId, bus, params);
    const seeded = rng();
    const t0 = ctx.currentTime + 0.3;
    const end = t0 + seconds;
    let lateMax = 0;
    const trigger = (h: Hit) => {
        lateMax = Math.max(lateMax, ctx.currentTime - (t0 + h.at));
        seeded(() => kit.trigger(h.sound, t0 + h.at, h.v));
    };
    if (sched === 'upfront') list.forEach(trigger);
    else {
        let next = 0;
        const timer = setInterval(() => {
            while (next < list.length && t0 + list[next].at < ctx.currentTime + 0.1) trigger(list[next++]);
        }, 25);
        signal.addEventListener('abort', () => clearInterval(timer), { once: true });
        while (next < list.length && !signal.aborted) await new Promise((r) => setTimeout(r, 50));
        clearInterval(timer);
    }
    while (ctx.currentTime < end && !signal.aborted) await new Promise((r) => setTimeout(r, 50));
    rec.port.postMessage('stop');
    await new Promise((r) => setTimeout(r, 100));
    bus.disconnect();
    rec.disconnect();
    if (sounds) tapNode(sounds, tap).disconnect(rec);
    setTimeout(() => kit.dispose(), 1000);

    // blocks in arrival order (currentFrame is sometimes off by one block: f, f, f+256), gaps = frame numbers that don't follow
    const first = chunks[0]?.frame ?? 0;
    const data = new Float32Array(chunks.length * 128);
    /** Odd frame numbers: [time from t0 in s, frames off]. */
    const gapList: [number, number][] = [];
    for (let i = 0; i < chunks.length; i++) {
        const missing = i ? chunks[i].frame - chunks[i - 1].frame - 128 : 0;
        if (missing) gapList.push([+(chunks[i - 1].frame / ctx.sampleRate - t0 + 128 / ctx.sampleRate).toFixed(4), missing]);
        data.set(chunks[i].data, i * 128);
    }
    return { data, startTime: first / ctx.sampleRate, t0, rate: ctx.sampleRate, lateMax, gaps: gapList.length, gapList };
}

/** Chrome's output glitch counters (AudioContext.playoutStats), null where the browser has none. */
function playout(): Record<string, number> | null {
    const st = (audioContext() as AudioContext & { playoutStats?: Record<string, number> }).playoutStats;
    if (!st) return null;
    const out: Record<string, number> = {};
    for (const k of ['fallbackFramesEvents', 'fallbackFramesDuration', 'totalFramesDuration', 'underrunEvents', 'underrunDuration']) if (typeof st[k] === 'number') out[k] = +st[k].toFixed(3);
    return out;
}

/** Chrome's AudioContext.renderCapacity (render load + underruns per second) while a run plays; returns a summary getter. */
function renderLoad(): () => string {
    type Update = { averageLoad: number; peakLoad: number; underrunRatio: number };
    const rc = (audioContext() as AudioContext & { renderCapacity?: EventTarget & { start(o: object): void; stop(): void } }).renderCapacity;
    if (!rc) return () => 'renderCapacity n/a';
    const updates: Update[] = [];
    const on = (e: Event) => updates.push(e as unknown as Update);
    rc.addEventListener('update', on);
    rc.start({ updateInterval: 1 });
    return () => {
        rc.stop();
        rc.removeEventListener('update', on);
        const f = (v: number) => v.toFixed(3);
        return updates.map((u) => `avg ${f(u.averageLoad)} peak ${f(u.peakLoad)} underrun ${f(u.underrunRatio)}`).join(' / ') || 'no updates';
    };
}

const stats = (x: Float32Array) => {
    let peak = 0, jump = 0, at = 0;
    for (let i = 1; i < x.length; i++) {
        peak = Math.max(peak, Math.abs(x[i]));
        const d = Math.abs(x[i] - x[i - 1]);
        if (d > jump) (jump = d), (at = i);
    }
    return { peak: +peak.toFixed(3), jump: +jump.toFixed(3), jumpAt: +(at / 48000).toFixed(4) };
};

/** Where |diff| > 0.01: the first times (s, from the pattern start), at least 20 ms apart. */
function spots(diff: Float32Array, rate: number, lead: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < diff.length && out.length < 16; i++)
        if (Math.abs(diff[i]) > 0.01 && (!out.length || i / rate - lead - out[out.length - 1] > 0.02)) out.push(+(i / rate - lead).toFixed(4));
    return out;
}

export const drumRender: Mode = {
    label: 'Drum render',
    help: 'Kick / snare (lambada steps) through a drum kit. Offline: a, b, both and their difference. live=a|b|both: plays it, records in the graph and compares with an offline render of the same calls (sched=lookahead|upfront). live=sine: a test sine. Params: kit, bpm, bars, a, b, drive.',
    async run(_m, signal, ctx) {
        const p = ctx.params;
        const kit = p.kit ?? 'tone';
        const bpm = Number(p.bpm ?? 115);
        const bars = Number(p.bars ?? 4);
        const a = Number(p.a ?? 0);
        const b = Number(p.b ?? 1);
        const params: Params = {};
        if (p.drive) for (let i = 0; i < 8; i++) params[`${i}.drive`] = Number(p.drive);
        if (p.params === 'song') {
            // the first drums track of the active μOp project
            const track = loadProject(activeProject().id).tracks.find((t) => t.kind === 'drums');
            Object.assign(params, track?.params ?? {});
            ctx.log(`drum-render params from the song: ${JSON.stringify(params)}`);
        }
        const seconds = lengthOf(bpm, bars);
        const tone = await import('tone');

        if (p.song) {
            // the active μOp project's drum tracks: kit + parameters (to render with the real settings)
            const info = activeProject();
            const song = loadProject(info.id);
            song.tracks.forEach((t, i) => {
                if (t.kind) ctx.log(`drum-render song "${info.name}" track ${i + 1} ${t.kind} ${t.name}: sound ${t.sound} level ${t.level} mute ${t.mute} params ${JSON.stringify(t.params)}`);
            });
            ctx.log(`drum-render song bpm ${song.bpm} swing ${song.swing} volume ${song.volume}`);
            return untilAborted(signal);
        }

        if (p.live === 'sine') {
            const ac = audioContext();
            const osc = new OscillatorNode(ac, { frequency: 110 });
            const g = new GainNode(ac, { gain: 0 });
            osc.connect(g).connect(ac.destination);
            const t = ac.currentTime + 0.1;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.5, t + 0.05);
            g.gain.setValueAtTime(0.5, t + 9);
            g.gain.linearRampToValueAtTime(0, t + 9.05);
            osc.start(t);
            osc.stop(t + 9.1);
            ctx.log('drum-render live sine 110 Hz, 9 s');
            return untilAborted(signal);
        }

        if (p.live) {
            const sounds = p.live === 'a' ? [a] : p.live === 'b' ? [b] : [a, b];
            const sched = p.sched ?? 'lookahead';
            const list = hits(sounds, bpm, bars);
            ctx.log(`drum-render live ${kit} ${p.live} (${sounds.join('+')}) ${sched}, ${bars} bars at ${bpm} bpm, audio ${audioContext().state}`);
            await render(kit, list, 1, 0.05, params, audioContext().sampleRate); // warm-up (Tone's noise buffers)
            const before = playout();
            const load = renderLoad();
            const live = await playLive(kit, list, seconds, params, sched, signal, p.chain, p.tap);
            const after = playout();
            ctx.log(`drum-render render load: ${load()} | sinkId ${JSON.stringify((audioContext() as AudioContext & { sinkId?: unknown }).sinkId ?? null)}, base latency ${(audioContext().baseLatency * 1000).toFixed(1)} ms, output ${(audioContext().outputLatency * 1000).toFixed(1)} ms, rate ${audioContext().sampleRate}`);
            if (signal.aborted) return;
            // offline twin: same calls, same random numbers, hit times at the same sample positions
            const lead = live.t0 - live.startTime;
            const off = await render(kit, list, seconds, lead, params, live.rate, p.chain, p.tap);
            const n = Math.min(off.length, live.data.length);
            const diff = new Float32Array(n);
            for (let i = 0; i < n; i++) diff[i] = live.data[i] - off[i];
            const result = { kit, sched, live: stats(live.data), offline: stats(off.subarray(0, n)), diff: stats(diff), lateMaxMs: +(live.lateMax * 1000).toFixed(1), recorderGaps: live.gaps };
            ctx.log(
                `drum-render live vs offline ${kit} ${p.live} ${sched}: diff peak ${result.diff.peak} (live peak ${result.live.peak}, offline ${result.offline.peak}), late ${result.lateMaxMs} ms, recorder gaps ${live.gaps}`,
                result,
            );
            ctx.log(`drum-render gaps (s from start, frames): ${live.gapList.map(([t, f]) => `${t}:${f}`).join(' ') || 'none'} | playoutStats ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
            // best alignment: the lag (live later by n samples) with the smallest peak difference
            let best = { lag: 0, peak: Infinity };
            for (let lag = -300; lag <= 300; lag++) {
                let peak = 0;
                for (let i = 1000; i < n - 1000; i += 2) peak = Math.max(peak, Math.abs(live.data[i + lag] - off[i]));
                if (peak < best.peak) best = { lag, peak: +peak.toFixed(4) };
            }
            {
                let mi = 0;
                for (let i = 0; i < n; i++) if (Math.abs(diff[i]) > Math.abs(diff[mi])) mi = i;
                const row = (x: Float32Array) => Array.from(x.subarray(mi - 12, mi + 12), (v) => v.toFixed(3)).join(' ');
                ctx.log(`drum-render max diff at ${(mi / live.rate - lead).toFixed(4)} s\nlive    ${row(live.data)}\noffline ${row(off)}`);
            }
            ctx.log(`drum-render best alignment: live ${best.lag} samples later than offline, diff peak then ${best.peak}`);
            const sp = spots(diff, live.rate, lead);
            const step = 60 / bpm / 4;
            ctx.log(`drum-render diff > 0.01 at s: ${sp.map((s) => `${s} (step ${(s / step).toFixed(2)})`).join(' ') || 'none'}`);
            return untilAborted(signal);
        }

        await render(kit, hits([a, b], bpm, 1), 1, 0.05, params, 48000); // warm-up
        const xa = await render(kit, hits([a], bpm, bars), seconds, 0.05, params, 48000);
        const xb = await render(kit, hits([b], bpm, bars), seconds, 0.05, params, 48000);
        const xab = await render(kit, hits([a, b], bpm, bars), seconds, 0.05, params, 48000);
        const diff = xab.map((v, i) => v - xa[i] - xb[i]);
        const result = { kit, bpm, a: stats(xa), b: stats(xb), both: stats(xab), diff: stats(diff) };
        if (p.dump) {
            // samples of a around dump=<s> (± 0.6 ms)
            const i = Math.round(Number(p.dump) * 48000);
            ctx.log(`drum-render dump a @${p.dump}: ${Array.from(xa.subarray(i - 30, i + 30), (v) => v.toFixed(3)).join(' ')}`);
        }
        ctx.log(`drum-render ${kit}: a ${JSON.stringify(result.a)} b ${JSON.stringify(result.b)} both ${JSON.stringify(result.both)} diff ${JSON.stringify(result.diff)}`, result);
        ctx.log(`drum-render diff > 0.01 at s: ${spots(diff, 48000, 0.05).join(' ') || 'none'}`);
        void tone;
        await untilAborted(signal);
    },
};
