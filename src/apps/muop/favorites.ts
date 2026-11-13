// μOp favorite sounds (STAR): an instrument + its parameter values, shared by all songs (localStorage).
// The sound browser (SEARCH / PLUG-IN "Sound") lists the instruments of a track kind, then the favorites.
import { findInstrument, resolve, type Params } from '../../engine/instruments';
import { soundsFor } from './sounds';
import type { TrackKind } from './model';

const KEY = 'muop-favorites';

export interface Favorite {
    name: string;
    /** 'drums' = a drum kit, 'melodic' = notes / chords instruments. */
    group: 'drums' | 'melodic';
    sound: string;
    params: Params;
}

/** One entry of the sound browser. `favorite` = index into the favorites. */
export interface SoundEntry {
    name: string;
    sound: string;
    params: Params;
    favorite?: number;
}

export const groupOf = (kind: TrackKind): Favorite['group'] => (kind === 'drums' ? 'drums' : 'melodic');

let cache: Favorite[] | null = null;

export function favorites(): Favorite[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(KEY);
        const list = raw ? (JSON.parse(raw) as Favorite[]) : [];
        cache = Array.isArray(list) ? list.filter((f) => f && typeof f.sound === 'string' && f.params) : [];
    } catch {
        cache = [];
    }
    return cache;
}

function store(): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(favorites()));
    } catch {
        // blocked storage: favorites live until the reload
    }
}

/** Saves a sound as a favorite, named after the instrument ("Mono lead 2"). Returns its name. */
export function addFavorite(kind: TrackKind, sound: string, params: Params): string {
    const def = findInstrument(soundsFor(kind), sound);
    const group = groupOf(kind);
    const n = favorites().filter((f) => f.group === group && f.sound === def.id).length + 1;
    const name = `${def.name} ${n}`;
    favorites().push({ name, group, sound: def.id, params: resolve(def.params, params) });
    store();
    return name;
}

export function removeFavorite(index: number): void {
    favorites().splice(index, 1);
    store();
}

/** Same instrument and the same values (defaults filled in)? */
export function sameSound(kind: TrackKind, a: { sound: string; params: Params }, b: { sound: string; params: Params }): boolean {
    if (a.sound !== b.sound) return false;
    const defs = findInstrument(soundsFor(kind), a.sound).params;
    const ra = resolve(defs, a.params);
    const rb = resolve(defs, b.params);
    return defs.every((d) => Math.abs(ra[d.id] - rb[d.id]) < 1e-6);
}

/** The favorite this sound is, -1 = none. */
export function favoriteOf(kind: TrackKind, sound: string, params: Params): number {
    const group = groupOf(kind);
    return favorites().findIndex((f) => f.group === group && sameSound(kind, f, { sound, params }));
}

/**
 * The browser list for a track kind: the instruments (default values), then the favorites. `edited` (the track's
 * own tweaked sound) is listed after its instrument, so browsing away and back finds it again.
 */
export function soundList(kind: TrackKind, edited?: { sound: string; params: Params }): SoundEntry[] {
    const list: SoundEntry[] = [];
    const editedIsFav = edited && favoriteOf(kind, edited.sound, edited.params) >= 0;
    for (const def of soundsFor(kind)) {
        list.push({ name: def.name, sound: def.id, params: {} });
        if (edited && !editedIsFav && edited.sound === def.id && !sameSound(kind, edited, { sound: def.id, params: {} })) {
            list.push({ name: `${def.name} (edited)`, sound: def.id, params: { ...edited.params } });
        }
    }
    const group = groupOf(kind);
    favorites().forEach((f, i) => {
        if (f.group === group) list.push({ name: `★ ${f.name}`, sound: f.sound, params: { ...f.params }, favorite: i });
    });
    return list;
}

/** Where a sound is in the list, -1 = not there. */
export const indexIn = (kind: TrackKind, list: SoundEntry[], sound: string, params: Params) =>
    list.findIndex((e) => sameSound(kind, e, { sound, params }));
