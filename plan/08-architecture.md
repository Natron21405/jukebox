## Architecture

Nathan decided that v1 goes straight to the cloud on Supabase. Everything else in the design is left to the build agent, who should record each decision and its reason in the repo README.

**Requirements any design must meet**

- Real-time two-way messaging between one host screen and up to about 12 phones, with answers appearing on the host within a fraction of a second.
- Join by short room code and by scanning a QR code on the host screen. The QR must encode the public address of the deployed site.
- Mobile-first phone pages that need no install, no login and no app store.
- Players rejoin the same seat after a refresh, a closed tab or a dropped connection, including from a different browser by entering the room code and their old name (see Core loop, Rejoining).
- A name already in use by a connected player in the same room is rejected with a friendly message.
- The host page can be refreshed without ending the game.
- Songs are never repeated, within a game or across games, and blocked songs are skipped. Both need stored state.
- Game rules, scoring, the artist matcher and the sudden-death logic should be plain functions with automated tests, separate from the network code.
- Cheating is not a concern. A static song file that includes the answers is acceptable.

**What using Supabase implies** (details for the agent to decide)

- **Live updates:** Supabase Realtime carries messages between the host and phones during a round.
- **Saved state:** because rejoining is a hard requirement, keep room, player, round, answer, timeline, play-history and blocklist state in the Supabase database, not only in a browser tab's memory. A refreshed host or phone then reloads its state instead of losing it. The agent decides the exact split between database rows and realtime messages.
- **Access rules:** the public key ships to every browser, so turn on Row Level Security and write simple policies suited to a casual game, rather than leaving tables open.
- **Where the web app lives:** Supabase serves the data, not the pages. The static site is hosted on GitHub Pages (decided). Set the site's base path for the repository address, and check whether the repository must be public for free Pages. Nathan is fine with the song file being publicly readable.
- **Idle projects:** check whether a free Supabase project pauses when unused and how to wake it, so it does not catch the group out on game night.
- **Limits:** check current free-tier connection and message limits against 12 phones plus a host before committing.

**Frontend stack.** Not specified. Prefer something small that builds to static files and works well on phone browsers (a plain TypeScript or JavaScript app, or a light framework). Avoid a heavy toolchain for a one-evening game.
