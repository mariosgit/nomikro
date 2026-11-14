// μOp projects: several songs in this browser's localStorage, one of them active, plus export / import as a text
// string to copy and paste. Framework-free.
//
// Storage: 'muop/projects' = { active, list: [{ id, name, updated }] }, each song under 'muop/project/<id>' (JSON).
// The song before projects existed ('muop/song/v2' / v1) becomes the first project "Song 1".
// Not in a project (they belong to this computer / browser): STAR favorites, audio inputs.
import { legacySong, newSong, parseSong, type Song } from './model';

const INDEX_KEY = 'muop/projects';
const songKey = (id: string) => `muop/project/${id}`;

export interface ProjectInfo {
    id: string;
    name: string;
    /** Last save, ms since epoch. */
    updated: number;
}

interface Index {
    active: string;
    list: ProjectInfo[];
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function readIndex(): Index | null {
    try {
        const ix = JSON.parse(localStorage.getItem(INDEX_KEY) ?? 'null') as Index | null;
        return ix?.list?.length ? ix : null;
    } catch {
        return null;
    }
}

function writeIndex(ix: Index): void {
    try {
        localStorage.setItem(INDEX_KEY, JSON.stringify(ix));
    } catch {
        // storage blocked: projects live for this page only
    }
}

/** The index, created on first use (from the song saved before projects existed, or a new song). */
function index(): Index {
    const ix = readIndex();
    if (ix) {
        if (!ix.list.some((p) => p.id === ix.active)) ix.active = ix.list[0].id;
        return ix;
    }
    const first: ProjectInfo = { id: newId(), name: 'Song 1', updated: Date.now() };
    const fresh = { active: first.id, list: [first] };
    writeSong(first.id, legacySong() ?? newSong());
    writeIndex(fresh);
    return fresh;
}

/** Writes the song; false if storage is full / blocked (the error is logged). */
function writeSong(id: string, song: Song): boolean {
    try {
        localStorage.setItem(songKey(id), JSON.stringify(song));
        return true;
    } catch (error) {
        console.error('μOp: saving the project failed (storage full?)', error);
        return false;
    }
}

/** All projects, most recently saved first, and the active one's id. */
export function projects(): { active: string; list: ProjectInfo[] } {
    const ix = index();
    return { active: ix.active, list: [...ix.list].sort((a, b) => b.updated - a.updated) };
}

export const activeProject = (): ProjectInfo => {
    const ix = index();
    return ix.list.find((p) => p.id === ix.active)!;
};

/** The project's song (a new song if it's missing or unreadable). */
export function loadProject(id: string): Song {
    try {
        const raw = localStorage.getItem(songKey(id));
        const song = raw ? parseSong(JSON.parse(raw)) : null;
        if (song) return song;
    } catch (error) {
        console.error('μOp: loading the project failed', error);
    }
    return newSong();
}

export function saveProject(id: string, song: Song): void {
    const ix = index();
    const p = ix.list.find((x) => x.id === id);
    if (!p) return; // deleted meanwhile
    if (writeSong(id, song)) {
        p.updated = Date.now();
        writeIndex(ix);
    }
}

export function setActiveProject(id: string): void {
    const ix = index();
    if (!ix.list.some((p) => p.id === id)) return;
    ix.active = id;
    writeIndex(ix);
}

/** "Song 3": the first free number. */
function freeName(base = 'Song'): string {
    const names = new Set(index().list.map((p) => p.name));
    for (let n = 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Adds a project (a new song with the starter groove, or the given one) and makes it active. */
export function createProject(name?: string, song: Song = newSong()): ProjectInfo {
    const ix = index();
    const p: ProjectInfo = { id: newId(), name: name?.trim() || freeName(), updated: Date.now() };
    if (!writeSong(p.id, song)) throw new Error('Browser storage is full: delete a project first');
    ix.list.push(p);
    ix.active = p.id;
    writeIndex(ix);
    return p;
}

export function duplicateProject(id: string): ProjectInfo {
    const src = index().list.find((p) => p.id === id);
    return createProject(src ? `${src.name} copy` : undefined, loadProject(id));
}

export function renameProject(id: string, name: string): void {
    const ix = index();
    const p = ix.list.find((x) => x.id === id);
    if (!p || !name.trim()) return;
    p.name = name.trim();
    writeIndex(ix);
}

/** Deletes the project; the last one can't go (a new empty one takes its place). Returns the active project's id. */
export function deleteProject(id: string): string {
    const ix = index();
    ix.list = ix.list.filter((p) => p.id !== id);
    try {
        localStorage.removeItem(songKey(id));
    } catch {
        // blocked storage
    }
    if (!ix.list.length) {
        const p: ProjectInfo = { id: newId(), name: 'Song 1', updated: Date.now() };
        writeSong(p.id, newSong());
        ix.list.push(p);
    }
    if (ix.active === id) ix.active = [...ix.list].sort((a, b) => b.updated - a.updated)[0].id;
    writeIndex(ix);
    return ix.active;
}

// --- export / import: `muop1:<base64url of gzip(JSON)>` ---
//
// The tag says how the rest is encoded, so old strings stay readable when the format changes:
// muop1 = gzip JSON of { app: 'muop', format: 1, name, song }. The song keeps its own `version` (parseSong migrates).
// Plain JSON (the same object, or a bare song) is accepted on import too.

const TAG = 'muop1:';

interface ExportFile {
    app: 'muop';
    format: 1;
    name: string;
    song: Song;
}

async function gzip(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

const toBase64Url = (bytes: Uint8Array) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The project as a text string to copy (a typical song: a few K characters). */
export async function exportProject(id: string): Promise<string> {
    const p = index().list.find((x) => x.id === id);
    const file: ExportFile = { app: 'muop', format: 1, name: p?.name ?? 'Song', song: loadProject(id) };
    return TAG + toBase64Url(await gzip(JSON.stringify(file)));
}

/** Reads an exported string (or JSON) → name + song. Throws with a readable message if it isn't one. */
export async function parseExport(text: string): Promise<{ name: string; song: Song }> {
    const t = text.trim().replace(/\s+/g, ''); // pasted strings may be wrapped
    let data: unknown;
    if (/^muop\d+:/.test(t)) {
        if (!t.startsWith(TAG)) throw new Error(`Unknown format "${t.slice(0, t.indexOf(':'))}": made with a newer μOp?`);
        try {
            data = JSON.parse(await gunzip(fromBase64Url(t.slice(TAG.length))));
        } catch {
            throw new Error('The text is damaged (incomplete copy?)');
        }
    } else {
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Not a μOp project (expected text starting with "muop1:")');
        }
    }
    const file = data as Partial<ExportFile>;
    const song = parseSong(file.app === 'muop' ? file.song : data);
    if (!song) throw new Error('Not a μOp project');
    return { name: (file.app === 'muop' && file.name) || 'Imported', song };
}

/** Imports an exported string as a new project (never overwrites one) and makes it active. */
export async function importProject(text: string): Promise<ProjectInfo> {
    const { name, song } = await parseExport(text);
    const taken = new Set(index().list.map((p) => p.name));
    return createProject(taken.has(name) ? `${name} (imported)` : name, song);
}
