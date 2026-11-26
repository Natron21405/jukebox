-- Play Again must start clean. Before, only scores and timelines were reset, so the previous game's last round (with its
-- reveal, answers and locks) stayed "the latest round" and every screen that read the room state saw old results.
-- Now the room's rounds go (answers, locks and round secrets cascade) and the result keys in settings are cleared.
-- play_history is a separate table with no link to rounds, so "no song repeats across games" still holds.
create or replace function public.host_new_game(p_room uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform private.assert_host(p_room, p_token);
  delete from public.rounds where room_id = p_room;
  update public.rooms
     set game_no = game_no + 1, round_no = 0, status = 'lobby', updated_at = now(),
         settings = settings - 'roundsPlayed' - 'suddenDeath' - 'winnerId' - 'decidedBy'
   where id = p_room returning * into v_room;
  update public.players set score = 0, artist_hits = 0, timeline = '[]'::jsonb where room_id = p_room;
  return to_jsonb(v_room);
end $$;
