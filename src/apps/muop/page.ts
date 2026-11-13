// Pages: hold a button = its page. While held, the page owns `< >` (pick a parameter), the encoder (change it),
// encoder push (apply), the pads (if it shows any) and the strip (if it uses it). Release = back to playing.
// The same page data drives the routing, the button lights, the display text and the Controls cheat sheet.
// Framework-free: no React, no song model (μOp builds its pages in controller.ts).
import type { Color, InputEvent, LedButton } from '../../maschine';

export interface Cell {
    color: Color;
    level: number;
}

/** One `< >` parameter of a page. Methods are only called while the page is held (not for the cheat sheet). */
export interface Param {
    name: string;
    /** Current value for the display. */
    value(): string;
    /** Encoder turn, delta in encoder steps. */
    step(delta: number): void;
    /** Cheat sheet text (default: the name). */
    help?: string;
}

export interface Help {
    keys: string;
    text: string;
}

interface Action {
    /** Short name for the display / cheat sheet. */
    name: string;
    run(): void;
}

export interface Page {
    button: LedButton;
    /** Display line 1. */
    name: string;
    /** Display line 2 when the page opens and has no parameters (e.g. "pad = track"). */
    hint?: string;
    params?: readonly Param[];
    /** The pads while held. Without it the pads stay playable. */
    cells?(): Cell[];
    padDown?(pad: number, velocity: number, time: number): void;
    /** Strip position 1..200, 0 = released. Without it the strip keeps its normal job. */
    strip?(position: number): void;
    /** Encoder push while held. */
    apply?: Action;
    /** Short press (released < TAP_MS, nothing else touched). Runs on release. */
    tap?: Action;
    /** Page opened. May return the parameter to start on. */
    open?(): number | void;
    close?(): void;
    /** Other buttons that do something while the page is held (lit dim, the rest goes dark). */
    buttons?: readonly LedButton[];
    /**
     * A modifier page (e.g. ERASE) only becomes active when no other page is held:
     * ERASE + PERFORM is the PERFORM page with ERASE held, in either press order.
     */
    modifier?: boolean;
    /** Cheat sheet rows beside the generated ones (pads, combos). */
    help?: readonly Help[];
}

export const TAP_MS = 300;

/** Printed button name, e.g. 'plug_in' → 'PLUG-IN'. */
export const buttonLabel = (b: LedButton): string => (b === 'plug_in' ? 'PLUG-IN' : b.replace('_', ' ').toUpperCase());

export class Pages {
    /** Held pages, in press order. */
    private held: Page[] = [];
    private paramIndex = new Map<Page, number>();
    private byButton: Map<string, Page>;

    constructor(
        readonly all: readonly Page[],
        private say: (text: string) => void,
    ) {
        this.byButton = new Map(all.map((p) => [p.button, p]));
    }

    /** The page in charge: the last pressed one, modifier pages only when no other page is held. */
    get active(): Page | undefined {
        for (let i = this.held.length - 1; i >= 0; i--) if (!this.held[i].modifier) return this.held[i];
        return this.held[this.held.length - 1];
    }

    isPageButton(button: string): boolean {
        return this.byButton.has(button);
    }

    /** Routes an input event to the pages. Returns true if a page took it (the app doesn't handle it then). */
    handle(e: InputEvent): boolean {
        switch (e.type) {
            case 'buttonDown': {
                const page = this.byButton.get(e.button);
                if (page) {
                    this.held = [...this.held.filter((p) => p !== page), page];
                    this.show(page); // first, so a message from open() wins
                    const start = page.open?.();
                    if (typeof start === 'number') this.paramIndex.set(page, start);
                    return true;
                }
                const active = this.active;
                if (!active) return false;
                const params = active.params ?? [];
                if ((e.button === 'arrow_left' || e.button === 'arrow_right') && params.length > 1) {
                    const i = this.index(active) + (e.button === 'arrow_right' ? 1 : -1);
                    this.paramIndex.set(active, Math.min(params.length - 1, Math.max(0, i)));
                    this.show(active);
                    return true;
                }
                if (e.button === 'enc-push' && active.apply) {
                    active.apply.run();
                    return true;
                }
                return false;
            }
            case 'buttonUp': {
                const page = this.byButton.get(e.button);
                if (!page) return false;
                this.held = this.held.filter((p) => p !== page);
                page.close?.();
                if (page.tap && !e.chorded && e.duration < TAP_MS) page.tap.run();
                return true;
            }
            case 'encoder': {
                const page = this.active;
                const param = page?.params?.[this.index(page)];
                if (!page || !param) return false;
                param.step(e.delta);
                this.show(page);
                return true;
            }
            case 'padDown': {
                const page = this.active;
                if (!page?.padDown) return false;
                page.padDown(e.pad, e.velocity, e.time);
                return true;
            }
            case 'strip': {
                const page = this.active;
                if (!page?.strip) return false;
                page.strip(e.position);
                return true;
            }
            default:
                return false;
        }
    }

    /**
     * Button lights. `levels` = the app's levels (1 = usable, ≥ 2 = a state such as playing).
     * Page buttons: dim, bright while held. While a page is held, buttons it doesn't use lose their dim
     * "usable" light (states stay), the ones it uses (incl. `< >` when it has several parameters) are lit.
     */
    lights(levels: Map<LedButton, number>, isHeld: (b: LedButton) => boolean): Map<LedButton, number> {
        const out = new Map(levels);
        for (const p of this.all) out.set(p.button, isHeld(p.button) ? 4 : Math.max(1, levels.get(p.button) ?? 0));
        const active = this.active;
        if (!active) return out;
        const used = new Set<LedButton>([...this.held.map((p) => p.button), ...(active.buttons ?? [])]);
        if ((active.params?.length ?? 0) > 1) used.add('arrow_left').add('arrow_right');
        for (const [b, level] of out) if (!used.has(b) && level <= 1) out.set(b, 0);
        for (const b of used) out.set(b, isHeld(b) ? 4 : Math.max(1, out.get(b) ?? 0));
        return out;
    }

    /** Cheat sheet rows, generated from the page data. */
    help(): Help[] {
        return this.all.flatMap((p) => {
            const key = buttonLabel(p.button);
            const rows: Help[] = [];
            const params = p.params ?? [];
            if (params.length) {
                rows.push({
                    keys: `${key}${params.length > 1 ? ' + < >' : ''} + encoder`,
                    text: params.map((q) => q.help ?? q.name).join(' · '),
                });
            }
            rows.push(...(p.help ?? []));
            if (p.apply) rows.push({ keys: `${key} + encoder push`, text: p.apply.name });
            if (p.tap) rows.push({ keys: `${key} (short press)`, text: p.tap.name });
            return rows;
        });
    }

    private index(page: Page): number {
        return Math.min(this.paramIndex.get(page) ?? 0, Math.max(0, (page.params?.length ?? 1) - 1));
    }

    /** Display: page name + current parameter (or the hint). */
    private show(page: Page): void {
        const params = page.params ?? [];
        if (!params.length) return this.say(page.hint ? `${page.name}\n${page.hint}` : page.name);
        const i = this.index(page);
        const param = params[i];
        if (params.length === 1) return this.say(`${page.name}\n${param.value()}`);
        this.say(`${page.name}  ${i + 1}/${params.length}\n${param.name}: ${param.value()}`);
    }
}
