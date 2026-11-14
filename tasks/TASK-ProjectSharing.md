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
- [ ] sparse JSON (shorter strings, see TASK-MüOperator "Song sharing").
- [ ] file download / upload (.json) besides the copy & paste text.
- [ ] storage: each project is ~110 KB JSON, localStorage holds ~5 MB → about 40 projects. Store compressed or sparse
  when that gets tight (New / Duplicate / Import show an error when storage is full).

## More ...

A cloud where everyone can upload her creations, and others can browse, random play, star it.

- github pages has no space to save stuff ?
- connector for 
  - nextcloud ? would be able to reed and write the whole thing ?!
  - soundcloud ? or such...