-- Found by the bot simulation (phase 12): a phone that says goodbye (seat_ping false) was flipped straight back to
-- "connected" by the host's presence mirror, because the host still saw the phone in its (stale) presence list for a
-- moment. A player moving to another device then got "name taken" for up to ~25 s.
-- Fix: a goodbye also back-dates last_seen, and the host only marks a seat connected from presence if the seat
-- has been heard from recently (any real phone heartbeats every 20 s).
create or replace function public.seat_ping(p_seat_token text, p_connected boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.player_secrets
    set last_seen = case when p_connected then now() else now() - interval '1 hour' end
    where seat_token = p_seat_token returning player_id into v_id;
  if v_id is null then return false; end if;
  update public.players set connected = p_connected where id = v_id and connected is distinct from p_connected;
  return true;
end $$;

create or replace function public.host_set_connected(p_room uuid, p_token text, p_connected_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  update public.players p set connected = true
    from public.player_secrets s
    where s.player_id = p.id and p.room_id = p_room and p.id = any(coalesce(p_connected_ids, '{}')) and not p.connected
      and s.last_seen > now() - interval '10 minutes';
  update public.players p set connected = false
    from public.player_secrets s
    where s.player_id = p.id and p.room_id = p_room and p.connected
      and not (p.id = any(coalesce(p_connected_ids, '{}')))
      and s.last_seen < now() - interval '10 seconds';
end $$;
