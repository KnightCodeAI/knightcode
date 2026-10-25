# @knightcode/desktop

## 0.2.0

### Added

- Added background terminals: the thread's summary lists running background commands under Background processes, each opening its live output in a side panel tab, with a Stop control shown on hover, and the transcript shows how each command stands and the notice of its end in place of the raw `<task-notification>` text.

- Added a game of chess to the home screen's knight mark: a click plays one of a few short games to mate, and another click ends it early. With reduced motion the mark stays still.

### Changed

- Changed the home screen to centre the mark and title in the space above the composer. In a short window the setup cards and title now scroll instead of being clipped from the top, and the composer stays on screen.

### Security

- Security: updated Electron from 44.7.0 to 44.9.3, past the advisories published for 44.7.0.
