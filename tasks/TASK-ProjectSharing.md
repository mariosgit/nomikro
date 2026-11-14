# TASK Project sharing

## project contains all data for the current song
- sounds, patterns, 
- midi and audio routing setup
  - others may not have the same devices.. at least save the device name.. the input section could add a description field. 

## Done: base project handling (2026-11-14)
- [x] Projects in localStorage (`src/apps/muop/projects.ts`): a list + the active one, each song under its own key, saved
  automatically. The song from before projects became "Song 1" (the old key stays as a backup).
- [x] Project bar above the pads (`projectbar.tsx`): select, New (starter groove), Duplicate, Rename, Delete (with
  confirmation), works without the device too. Switching restarts the device task with the other song.
- [x] Export / import as text to copy & paste: `muop1:` + base64url(gzip(JSON `{ app, format: 1, name, song }`)), ~1.8 K
  characters for a typical song. Import adds a new project (never overwrites), accepts wrapped text and plain JSON,
  clear messages for damaged text / newer formats / newer song versions. Checked in Node (17 checks).
- [x] On the device: hold PROJECT (top left), `< >` Create (new / duplicate) | Load (the list, starting at the loaded
  one *), turn = choose, push = do it; release without push = no change. The display shows the project name on start.
- [x] Switching never restarts μOp: the running controller loads the other song in place. Its instruments preload while the
  current song keeps playing (`Sounds.preload` / `install`), then the sequencer swaps the song at the next pattern start
  (`Sequencer.swapSong`, clock runs on, the new song starts at its first pattern). Stopped: right away. The display
  counts the beats down ("Next  Song 2 / 4..3..2..1..").
- Not in a project (belong to the computer): STAR favorites, audio inputs. Track MIDI ports are in the song (port id + name).

## save/load...
- [ ] share as a link: `#/muop?song=muop1:…` (the export string fits; ask before importing, or import as a new project).
- [ ] sparse JSON (shorter strings, notes below).
- [ ] file download / upload (.json) besides the copy & paste text.
- [ ] storage: each project is ~110 KB JSON, localStorage holds ~5 MB → about 40 projects. Store compressed or sparse
  when that gets tight (New / Duplicate / Import show an error when storage is full).
- [ ] Optional: include the STAR favorites (separate localStorage) used by the song's tracks.

Notes (moved from TASK-MüOperator "Song sharing"):
- Measured: the full `Song` JSON is ~110–120 KB even when nearly empty (every slot stored: 16 × 16 pattern tracks
  with 8 × 16 drum velocities each), plain base64 ~150–160 K chars. gzip + base64: new song ~1.4 K chars, all 16
  patterns × 16 tracks filled with random steps ~16 K (brotli ~0.6 K / ~14.5 K).
- URL: Chrome takes ~2 MB URLs; chat apps / QR codes (≤ ~2.9 KB) are tighter. On load from a link: ask before
  importing (or import as a new project, never replace the current one).
- Sparse share format: only non-empty patterns / tracks, drum hits as `[sound, step, vel]`, params only where set
  → a typical song a few hundred chars before compression. Expand back to a full `Song` on load (like `migrateV1()`),
  under a new tag (`muop2:`); `muop1:` strings keep working.

## More ...

A cloud where everyone can upload her creations, and others can browse, random play, star it.

- github pages has no space to save stuff ?
- connector for 
  - nextcloud ? would be able to reed and write the whole thing ?!
  - soundcloud ? or such...