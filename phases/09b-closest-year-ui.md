# 09b Closest Year UI: year picker, reveal, scoreboard

Read: plan/05-year-picker.md (all), plan/02-core-loop.md (screens).

## Do
Phone: the year picker exactly as specified (big readout, slider with decade ticks, plus/minus buttons with press-and-hold, optional decade chips, neutral starting position that does not hint at the answer), artist text box without suggestions, submit with locked-in confirmation and ability to change until time is up. Host: audio play via the preview URL (streamed from Apple, host device only), countdown, reveal screen, scoreboard, host "borderline artist" override control. Mobile-first and readable.

## Gate
- App builds; component tests for the picker (bounds, hold-repeat, no-hint start); a scripted end-to-end run with 3 browser-simulated players completes one round. Final message counts only.
