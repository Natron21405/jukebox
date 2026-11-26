# 12 Simulation with bots

Read: plan/11-milestones.md.

## Do
Write `tools/simulate.mjs`: runs 10 to 12 bot phones against the real Supabase project (using throwaway room codes, cleaned up afterwards) through a full game in each mode, with bots that randomly refresh and rejoin mid-game, one duplicate-name attempt, and the host refreshing mid-round. Bots answer with varied accuracy. Report only: games completed, rejoin successes, rule violations (should be zero), round timing stats. Fix any bugs it finds in the app. Check Realtime message volume against the free-tier limits and record it in README.

## Gate
- Both modes complete with 12 bots, zero rule violations, every rejoin succeeds. Final message counts only.
