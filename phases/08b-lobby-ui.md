# 08b Lobby and join UI

Read: plan/02-core-loop.md, plan/05-year-picker.md (only the layout principles), plan/01-overview.md.

## Do
Host screen: create room, big room code and join URL/QR, live player list with connected state, mode choice (Timeline or Closest Year, with its settings: win N, rounds), start button, kick option. Phone screen: enter code and name, friendly rejection of a duplicate name, automatic seat restore after refresh, "waiting for host" state. Mobile-first, large touch targets, works at 360px width, readable from across a room on the host screen. Keep styling simple and consistent. Everything driven by the net layer from 08a.

## Gate
- The app builds. A scripted test (headless browser or component tests) joins 3 fake phones, refreshes one and confirms it keeps its seat, and refreshes the host and confirms the lobby is restored. Note how to run the dev server in `.build/NOTES.md`.
