-- Host removes a player from the room (lobby "kick"). Cascades to the seat secret, answers and locks.
-- The kicked phone's seat token stops working, so its next refresh returns to the join screen.
create or replace function public.host_kick_player(p_room uuid, p_token text, p_player uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  delete from public.players where id = p_player and room_id = p_room;
end $$;

revoke all on function public.host_kick_player(uuid, text, uuid) from public;
grant execute on function public.host_kick_player(uuid, text, uuid) to anon, authenticated;
