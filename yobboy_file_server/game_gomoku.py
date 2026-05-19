from __future__ import annotations

import secrets
import threading
from datetime import datetime
from typing import Any, Dict, List

from flask import request
from flask_socketio import emit, join_room, leave_room

from .game_hub import GameHubStore, now_iso

ROOM_NAMESPACE = "/games-gomoku"
ROOM_TYPE = "gomoku"
BOARD_SIZE = 15
CHAT_TTL_SECONDS = 5
MARKER_TTL_SECONDS = 1.2
MAX_WAGER = 999999
WIN_REWARD_MULTIPLIER = 4
SURRENDER_WIN_REWARD_MULTIPLIER = 2
SURRENDER_LOSS_NUMERATOR = 1
SURRENDER_LOSS_DENOMINATOR = 2


class GomokuManager:
    def __init__(self, store: GameHubStore | None = None) -> None:
        self._lock = threading.RLock()
        self._store = store or GameHubStore()
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._load_rooms()

    def _default_board(self) -> List[List[int]]:
        return [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]

    def _load_rooms(self) -> None:
        for item in self._store.list_room_states(ROOM_TYPE):
            state = item.get("state") or {}
            room_code = str(state.get("room_code") or item.get("room_code") or "").strip().upper()
            players = state.get("players")
            if not room_code or not isinstance(players, list) or not players:
                continue
            state["room_code"] = room_code
            state.setdefault("status", "lobby")
            state.setdefault("created_at", now_iso())
            state.setdefault("updated_at", now_iso())
            state.setdefault("board", self._default_board())
            state.setdefault("host_player_id", players[0].get("player_id", ""))
            state.setdefault("turn_player_id", "")
            state.setdefault("winner_player_id", "")
            state.setdefault("winner_label", "")
            state.setdefault("move_count", 0)
            state.setdefault("match_index", 0)
            state.setdefault("history", [])
            state.setdefault("last_move", {})
            state.setdefault("spectators", [])
            state.setdefault("chat_messages", [])
            state.setdefault("markers", [])
            for player in players:
                player["sid"] = ""
                player["is_online"] = False
                player.setdefault("is_ready", False)
                player.setdefault("stone", 0)
                player.setdefault("wager", 0)
                player.setdefault("wager_set", False)
                player["cosmetics"] = self._sanitize_cosmetics(player.get("cosmetics"))
                player.setdefault("joined_at", now_iso())
                player.setdefault("last_seen", now_iso())
            for spectator in state.get("spectators") or []:
                if isinstance(spectator, dict):
                    spectator["sid"] = ""
                    spectator["is_online"] = False
                    spectator.setdefault("joined_at", now_iso())
                    spectator.setdefault("last_seen", now_iso())
            self._rooms[room_code] = state

    def _save_room(self, room: Dict[str, Any]) -> None:
        room["updated_at"] = now_iso()
        payload = dict(room)
        payload.pop("spectators", None)
        payload.pop("chat_messages", None)
        payload.pop("markers", None)
        self._store.save_room_state(ROOM_TYPE, room["room_code"], payload)

    def _delete_room(self, room_code: str) -> None:
        self._rooms.pop(room_code, None)
        self._store.delete_room_state(ROOM_TYPE, room_code)

    def _make_room_code(self) -> str:
        while True:
            code = secrets.token_hex(2).upper()
            if code not in self._rooms:
                return code

    def _active_players(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [player for player in room["players"] if not player.get("removed")]

    def _active_spectators(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [spectator for spectator in (room.get("spectators") or []) if not spectator.get("removed")]

    def _online_player_count(self, room: Dict[str, Any]) -> int:
        return sum(1 for player in self._active_players(room) if player.get("is_online"))

    def _online_spectator_count(self, room: Dict[str, Any]) -> int:
        return sum(1 for spectator in self._active_spectators(room) if spectator.get("is_online"))

    def _online_count(self, room: Dict[str, Any]) -> int:
        return self._online_player_count(room) + self._online_spectator_count(room)

    def _find_player(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return next((item for item in room["players"] if item["player_id"] == player_id and not item.get("removed")), None)

    def _find_spectator(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return next((item for item in (room.get("spectators") or []) if item["player_id"] == player_id and not item.get("removed")), None)

    def _room_member(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return self._find_player(room, player_id) or self._find_spectator(room, player_id)

    def _reset_match_state(self, room: Dict[str, Any], preserve_history: bool = True) -> None:
        room["status"] = "lobby"
        room["board"] = self._default_board()
        room["turn_player_id"] = ""
        room["winner_player_id"] = ""
        room["winner_label"] = ""
        room["last_move"] = {}
        room["move_count"] = 0
        room["markers"] = []
        if not preserve_history:
            room["history"] = []
            room["match_index"] = 0
        for player in self._active_players(room):
            player["is_ready"] = False
            player["stone"] = 0

    def _sanitize_cosmetics(self, cosmetics: Any) -> Dict[str, str]:
        payload = cosmetics if isinstance(cosmetics, dict) else {}
        return {
            "color_key": str(payload.get("color_key") or payload.get("colorKey") or "classic").strip()[:64] or "classic",
            "icon_key": str(payload.get("icon_key") or payload.get("iconKey") or "triangle").strip()[:64] or "triangle",
            "background_key": str(payload.get("background_key") or payload.get("backgroundKey") or "dojo").strip()[:64] or "dojo",
        }

    def _resolve_cosmetic_color_conflict(self, room: Dict[str, Any], player_id: str) -> None:
        player = self._find_player(room, player_id)
        if not player:
            return
        cosmetics = self._sanitize_cosmetics(player.get("cosmetics"))
        taken = {
            self._sanitize_cosmetics(other.get("cosmetics")).get("color_key")
            for other in self._active_players(room)
            if other.get("player_id") != player_id
        }
        if cosmetics["color_key"] in taken:
            for fallback in ("ember", "classic", "frost", "nuclear", "void"):
                if fallback not in taken:
                    cosmetics["color_key"] = fallback
                    break
        player["cosmetics"] = cosmetics

    def _prune_timed_entries(self, items: List[Dict[str, Any]], ttl_seconds: float) -> List[Dict[str, Any]]:
        now_value = datetime.fromisoformat(now_iso())
        kept: List[Dict[str, Any]] = []
        for entry in list(items or []):
            if not isinstance(entry, dict):
                continue
            try:
                created_at = datetime.fromisoformat(str(entry.get("created_at") or ""))
            except Exception:
                continue
            if (now_value - created_at).total_seconds() <= ttl_seconds:
                kept.append(entry)
        return kept

    def _prune_chat_messages(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        room["chat_messages"] = self._prune_timed_entries(list(room.get("chat_messages") or []), CHAT_TTL_SECONDS)[-20:]
        return room["chat_messages"]

    def _prune_markers(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        room["markers"] = self._prune_timed_entries(list(room.get("markers") or []), MARKER_TTL_SECONDS)[-30:]
        return room["markers"]

    def _total_score(self, player_id: str) -> int:
        summary = self._store.total_score_summary(str(player_id or "").strip())
        return int((summary or {}).get("total_score") or 0)

    def _wager_is_affordable(self, player_id: str, amount: int) -> bool:
        return max(0, int(amount or 0)) <= self._total_score(player_id)

    def _wager_loss_amount(self, amount: int, surrender: bool = False) -> int:
        wager_value = max(0, int(amount or 0))
        if not surrender:
            return wager_value
        return (wager_value * SURRENDER_LOSS_NUMERATOR + SURRENDER_LOSS_DENOMINATOR - 1) // SURRENDER_LOSS_DENOMINATOR

    def _winner_reward_amount(self, loser_wager: int, surrender: bool = False) -> int:
        wager_value = max(0, int(loser_wager or 0))
        multiplier = SURRENDER_WIN_REWARD_MULTIPLIER if surrender else WIN_REWARD_MULTIPLIER
        return wager_value * max(0, int(multiplier or 0))

    def _record_score_delta(self, player_id: str, score_delta: int, session_key: str, meta: Dict[str, Any]) -> None:
        if not player_id or not score_delta:
            return
        self._store.record_score(
            str(player_id),
            game_id=ROOM_TYPE,
            score=score_delta,
            mode="pvp",
            session_key=session_key,
            meta=meta,
        )

    def _finish_match(
        self,
        room: Dict[str, Any],
        winner_player_id: str = "",
        reason: str = "five_in_row",
        loser_player_id: str = "",
        loser_penalty: int | None = None,
        winner_reward: int | None = None,
    ) -> None:
        players = self._active_players(room)
        player_map = {str(player.get("player_id") or ""): player for player in players}
        winner = player_map.get(str(winner_player_id or ""))
        loser = player_map.get(str(loser_player_id or ""))
        room["status"] = "finished"
        room["turn_player_id"] = ""
        room["winner_player_id"] = str(winner_player_id or "")
        room["winner_label"] = self._player_label(winner) if winner else ("平局" if not winner_player_id else room.get("winner_label", ""))
        wagers = {
            str(player.get("player_id") or ""): int(player.get("wager") or 0)
            for player in players
        }
        score_changes: Dict[str, int] = {}
        if winner and loser:
            surrender = reason == "resign"
            loser_wager = int(loser.get("wager") or 0)
            resolved_loser_penalty = self._wager_loss_amount(loser_wager, surrender=surrender) if loser_penalty is None else max(0, int(loser_penalty or 0))
            resolved_winner_reward = self._winner_reward_amount(loser_wager, surrender=surrender) if winner_reward is None else max(0, int(winner_reward or 0))
            settlement_key = f"gomoku:{room['room_code']}:{int(room.get('match_index') or 0)}:{reason}"
            base_meta = {
                "room_code": room["room_code"],
                "match_index": int(room.get("match_index") or 0),
                "reason": reason,
                "winner_player_id": winner["player_id"],
                "winner_label": self._player_label(winner),
                "loser_player_id": loser["player_id"],
                "loser_label": self._player_label(loser),
                "winner_wager": int(winner.get("wager") or 0),
                "loser_wager": loser_wager,
                "move_count": int(room.get("move_count") or 0),
            }
            self._record_score_delta(
                winner["player_id"],
                resolved_winner_reward,
                f"{settlement_key}:winner:{winner['player_id']}",
                dict(base_meta, settlement_role="winner", score_delta=resolved_winner_reward),
            )
            self._record_score_delta(
                loser["player_id"],
                -resolved_loser_penalty,
                f"{settlement_key}:loser:{loser['player_id']}",
                dict(base_meta, settlement_role="loser", score_delta=-resolved_loser_penalty),
            )
            score_changes[winner["player_id"]] = resolved_winner_reward
            score_changes[loser["player_id"]] = -resolved_loser_penalty
        room["history"] = (room.get("history") or [])[-11:] + [{
            "match_index": int(room.get("match_index") or 0),
            "winner_player_id": str(winner_player_id or ""),
            "winner_label": room.get("winner_label") or ("平局" if not winner_player_id else ""),
            "loser_player_id": str(loser_player_id or ""),
            "loser_label": self._player_label(loser) if loser else "",
            "move_count": int(room.get("move_count") or 0),
            "finished_at": now_iso(),
            "finish_reason": reason,
            "wagers": wagers,
            "score_changes": score_changes,
        }]

    def _begin_match(self, room: Dict[str, Any], players: List[Dict[str, Any]]) -> None:
        room["match_index"] = int(room.get("match_index") or 0) + 1
        self._reset_match_state(room, preserve_history=True)
        room["status"] = "playing"
        black_index = (int(room.get("match_index") or 1) - 1) % 2
        black_player = players[black_index]
        white_player = players[1 - black_index]
        black_player["stone"] = 1
        white_player["stone"] = 2
        room["turn_player_id"] = black_player["player_id"]

    def _remove_player_from_room(self, room: Dict[str, Any], player_id: str, mark_removed: bool) -> bool:
        player = self._find_player(room, player_id)
        if not player:
            return False
        player["sid"] = ""
        player["is_online"] = False
        player["is_ready"] = False
        player["last_seen"] = now_iso()
        if mark_removed:
            player["removed"] = True
        active_players = self._active_players(room)
        if not active_players:
            self._delete_room(room["room_code"])
            return True
        if room.get("host_player_id") == player_id:
            room["host_player_id"] = active_players[0]["player_id"]
        if len(active_players) < 2 and room.get("status") != "finished":
            self._reset_match_state(room, preserve_history=True)
        elif room.get("turn_player_id") == player_id:
            for candidate in active_players:
                if candidate["player_id"] != player_id:
                    room["turn_player_id"] = candidate["player_id"]
                    break
        self._save_room(room)
        return True

    def _player_label(self, player: Dict[str, Any] | None) -> str:
        return str((player or {}).get("display_name") or "玩家")

    def player_sid(self, room_code: str, player_id: str) -> str:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return ""
            player = self._find_player(room, player_id)
            return str((player or {}).get("sid") or "")

    def rooms_for_player(self, player_id: str) -> List[str]:
        with self._lock:
            codes: List[str] = []
            for room_code, room in self._rooms.items():
                if self._find_player(room, player_id) or self._find_spectator(room, player_id):
                    codes.append(room_code)
            return codes

    def _public_room(self, room: Dict[str, Any], viewer_player_id: str | None = None) -> Dict[str, Any]:
        players = []
        for player in self._active_players(room):
            players.append({
                "player_id": player["player_id"],
                "display_name": player["display_name"],
                "avatar_url": player.get("avatar_url", ""),
                "is_online": bool(player.get("is_online")),
                "is_ready": bool(player.get("is_ready")),
                "stone": int(player.get("stone") or 0),
                "wager": int(player.get("wager") or 0),
                "wager_set": bool(player.get("wager_set")),
                "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
                "joined_at": player.get("joined_at", ""),
            })
        payload = {
            "room_code": room["room_code"],
            "status": room.get("status", "lobby"),
            "host_player_id": room.get("host_player_id", ""),
            "turn_player_id": room.get("turn_player_id", ""),
            "winner_player_id": room.get("winner_player_id", ""),
            "winner_label": room.get("winner_label", ""),
            "move_count": int(room.get("move_count") or 0),
            "match_index": int(room.get("match_index") or 0),
            "last_move": room.get("last_move") or {},
            "board": room.get("board") or self._default_board(),
            "history": list(room.get("history") or []),
            "players": players,
            "spectators": [{
                "player_id": spectator["player_id"],
                "display_name": spectator["display_name"],
                "avatar_url": spectator.get("avatar_url", ""),
                "is_online": bool(spectator.get("is_online")),
                "joined_at": spectator.get("joined_at", ""),
            } for spectator in self._active_spectators(room)],
            "player_count": len(players),
            "online_player_count": self._online_player_count(room),
            "online_spectator_count": self._online_spectator_count(room),
            "online_count": self._online_count(room),
            "spectator_count": len(self._active_spectators(room)),
            "chat_messages": self._prune_chat_messages(room),
            "markers": self._prune_markers(room),
        }
        payload["can_start"] = len(players) == 2 and all(player.get("is_ready") for player in players) and all(player.get("wager_set") for player in players)
        if viewer_player_id:
            player = self._find_player(room, viewer_player_id)
            spectator = self._find_spectator(room, viewer_player_id)
            payload["self_player_id"] = viewer_player_id
            payload["self_stone"] = int((player or {}).get("stone") or 0)
            payload["self_role"] = "player" if player else ("spectator" if spectator else "")
            payload["self_total_score"] = self._total_score(viewer_player_id)
        return payload

    def room_snapshots(self, room_code: str) -> List[Dict[str, Any]]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return []
            snapshots = []
            for player in self._active_players(room):
                sid = str(player.get("sid") or "").strip()
                if sid:
                    snapshots.append({"sid": sid, "payload": self._public_room(room, player["player_id"])})
            for spectator in self._active_spectators(room):
                sid = str(spectator.get("sid") or "").strip()
                if sid:
                    snapshots.append({"sid": sid, "payload": self._public_room(room, spectator["player_id"])})
            return snapshots

    def room_summaries(self) -> List[Dict[str, Any]]:
        with self._lock:
            items = []
            for room_code, room in sorted(self._rooms.items(), key=lambda item: (item[1].get("updated_at", ""), item[0]), reverse=True):
                players = self._active_players(room)
                if not players:
                    continue
                items.append({
                    "room_code": room_code,
                    "status": room.get("status", "lobby"),
                    "match_index": int(room.get("match_index") or 0),
                    "players": [{
                        "player_id": player["player_id"],
                        "display_name": player["display_name"],
                        "is_online": bool(player.get("is_online")),
                        "is_ready": bool(player.get("is_ready")),
                        "wager": int(player.get("wager") or 0),
                        "wager_set": bool(player.get("wager_set")),
                        "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
                    } for player in players],
                    "player_count": len(players),
                    "online_player_count": self._online_player_count(room),
                    "online_spectator_count": self._online_spectator_count(room),
                    "online_count": self._online_count(room),
                    "spectator_count": len(self._active_spectators(room)),
                    "updated_at": room.get("updated_at", ""),
                })
            return items

    def create_or_join_room(
        self,
        ip: str,
        player_id: str,
        sid: str,
        display_name: str,
        avatar_url: str = "",
        room_code: str | None = None,
        cosmetics: Dict[str, Any] | None = None,
        spectate: bool = False,
    ) -> Dict[str, Any]:
        player_id_value = str(player_id or "").strip()[:64]
        if not player_id_value:
            raise ValueError("缺少玩家标识")
        with self._lock:
            if room_code:
                code = str(room_code).strip().upper()
                room = self._rooms.get(code)
                if not room:
                    raise ValueError("房间不存在")
            else:
                code = self._make_room_code()
                room = {
                    "room_code": code,
                    "host_player_id": player_id_value,
                    "players": [],
                    "spectators": [],
                    "status": "lobby",
                    "board": self._default_board(),
                    "turn_player_id": "",
                    "winner_player_id": "",
                    "winner_label": "",
                    "last_move": {},
                    "move_count": 0,
                    "match_index": 0,
                    "history": [],
                    "chat_messages": [],
                    "markers": [],
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                self._rooms[code] = room

            for other_room_code, other_room in list(self._rooms.items()):
                if other_room_code == code:
                    continue
                if self._find_player(other_room, player_id_value):
                    self._remove_player_from_room(other_room, player_id_value, mark_removed=True)
                spectator = self._find_spectator(other_room, player_id_value)
                if spectator:
                    spectator["sid"] = ""
                    spectator["is_online"] = False
                    spectator["removed"] = True
                    self._save_room(other_room)

            active_players = self._active_players(room)
            player = self._find_player(room, player_id_value)
            spectator = self._find_spectator(room, player_id_value)
            if player is None:
                if bool(spectate):
                    if spectator is None:
                        room.setdefault("spectators", []).append({
                            "player_id": player_id_value,
                            "sid": sid,
                            "ip": ip,
                            "display_name": display_name,
                            "avatar_url": avatar_url,
                            "joined_at": now_iso(),
                            "last_seen": now_iso(),
                            "is_online": True,
                            "removed": False,
                        })
                    else:
                        spectator["sid"] = sid
                        spectator["ip"] = ip
                        spectator["display_name"] = display_name
                        spectator["avatar_url"] = avatar_url
                        spectator["last_seen"] = now_iso()
                        spectator["is_online"] = True
                        spectator["removed"] = False
                    self._save_room(room)
                    return self._public_room(room, player_id_value)
                if spectator:
                    spectator["sid"] = ""
                    spectator["is_online"] = False
                    spectator["removed"] = True
                if len(active_players) >= 2:
                    raise ValueError("房间已满")
                room["players"].append({
                    "player_id": player_id_value,
                    "sid": sid,
                    "ip": ip,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "joined_at": now_iso(),
                    "last_seen": now_iso(),
                    "is_online": True,
                    "is_ready": False,
                    "stone": 0,
                    "wager": 0,
                    "wager_set": False,
                    "cosmetics": self._sanitize_cosmetics(cosmetics),
                })
            else:
                player["sid"] = sid
                player["ip"] = ip
                player["display_name"] = display_name
                player["avatar_url"] = avatar_url
                player["last_seen"] = now_iso()
                player["is_online"] = True
                player["cosmetics"] = self._sanitize_cosmetics(cosmetics or player.get("cosmetics"))
            self._resolve_cosmetic_color_conflict(room, player_id_value)
            self._save_room(room)
            return self._public_room(room, player_id_value)

    def leave_room(self, room_code: str, player_id: str) -> Dict[str, Any] | None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return None
            player = self._find_player(room, player_id)
            spectator = self._find_spectator(room, player_id)
            if not player and spectator:
                spectator["sid"] = ""
                spectator["is_online"] = False
                spectator["removed"] = True
                self._save_room(room)
                return self._public_room(room, "")
            if not player:
                return self._public_room(room, "")
            active_players = self._active_players(room)
            if not active_players:
                return None
            if room.get("status") == "playing" and len(active_players) == 2:
                opponent = next((item for item in active_players if item.get("player_id") != player_id), None)
                if opponent:
                    self._finish_match(
                        room,
                        winner_player_id=opponent["player_id"],
                        loser_player_id=player_id,
                        reason="leave",
                    )
            self._remove_player_from_room(room, player_id, mark_removed=True)
            refreshed = self._rooms.get(room["room_code"])
            if not refreshed:
                return None
            remaining_players = self._active_players(refreshed)
            return self._public_room(refreshed, remaining_players[0]["player_id"] if remaining_players else "")

    def switch_membership(
        self,
        room_code: str,
        ip: str,
        player_id: str,
        sid: str,
        display_name: str,
        avatar_url: str = "",
        cosmetics: Dict[str, Any] | None = None,
        spectate: bool = False,
    ) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            player = self._find_player(room, player_id)
            spectator = self._find_spectator(room, player_id)
            cosmetics_payload = self._sanitize_cosmetics(cosmetics)
            if spectate:
                if spectator:
                    spectator["sid"] = sid
                    spectator["ip"] = ip
                    spectator["display_name"] = display_name
                    spectator["avatar_url"] = avatar_url
                    spectator["last_seen"] = now_iso()
                    spectator["is_online"] = True
                    spectator["removed"] = False
                    spectator["cosmetics"] = cosmetics_payload
                    self._save_room(room)
                    return self._public_room(room, player_id)
                if not player:
                    raise ValueError("玩家不在房间中")
                active_players = self._active_players(room)
                if len(active_players) <= 1:
                    raise ValueError("至少保留一个对局席位")
                wager = int(player.get("wager") or 0)
                wager_set = bool(player.get("wager_set"))
                if room.get("status") == "playing" and len(active_players) == 2:
                    opponent = next((item for item in active_players if item.get("player_id") != player_id), None)
                    if opponent:
                        self._finish_match(
                            room,
                            winner_player_id=opponent["player_id"],
                            loser_player_id=player_id,
                            reason="leave",
                        )
                self._remove_player_from_room(room, player_id, mark_removed=True)
                refreshed = self._rooms.get(str(room_code or "").strip().upper())
                if not refreshed:
                    raise ValueError("房间不存在")
                refreshed.setdefault("spectators", []).append({
                    "player_id": player_id,
                    "sid": sid,
                    "ip": ip,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "joined_at": now_iso(),
                    "last_seen": now_iso(),
                    "is_online": True,
                    "removed": False,
                    "cosmetics": cosmetics_payload,
                    "wager": wager,
                    "wager_set": wager_set,
                })
                self._save_room(refreshed)
                return self._public_room(refreshed, player_id)
            if player:
                player["sid"] = sid
                player["ip"] = ip
                player["display_name"] = display_name
                player["avatar_url"] = avatar_url
                player["last_seen"] = now_iso()
                player["is_online"] = True
                player["cosmetics"] = cosmetics_payload
                self._resolve_cosmetic_color_conflict(room, player_id)
                self._save_room(room)
                return self._public_room(room, player_id)
            if not spectator:
                raise ValueError("玩家不在房间中")
            active_players = self._active_players(room)
            if len(active_players) >= 2:
                raise ValueError("对局席位已满")
            spectator["sid"] = ""
            spectator["is_online"] = False
            spectator["removed"] = True
            room["players"].append({
                "player_id": player_id,
                "sid": sid,
                "ip": ip,
                "display_name": display_name,
                "avatar_url": avatar_url,
                "joined_at": spectator.get("joined_at") or now_iso(),
                "last_seen": now_iso(),
                "is_online": True,
                "is_ready": False,
                "stone": 0,
                "wager": int(spectator.get("wager") or 0),
                "wager_set": bool(spectator.get("wager_set")),
                "cosmetics": cosmetics_payload,
            })
            if not self._find_player(room, room.get("host_player_id", "")):
                room["host_player_id"] = player_id
            self._resolve_cosmetic_color_conflict(room, player_id)
            self._save_room(room)
            return self._public_room(room, player_id)

    def disconnect_player(self, sid: str) -> List[str]:
        affected_rooms: List[str] = []
        with self._lock:
            for room_code, room in list(self._rooms.items()):
                changed = False
                for player in self._active_players(room):
                    if str(player.get("sid") or "") == sid:
                        player["sid"] = ""
                        player["is_online"] = False
                        player["last_seen"] = now_iso()
                        changed = True
                for spectator in self._active_spectators(room):
                    if str(spectator.get("sid") or "") == sid:
                        spectator["sid"] = ""
                        spectator["is_online"] = False
                        spectator["last_seen"] = now_iso()
                        changed = True
                if changed:
                    affected_rooms.append(room_code)
                    self._save_room(room)
        return affected_rooms

    def toggle_ready(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") == "playing":
                raise ValueError("对局进行中，无法修改准备状态")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            player["is_ready"] = not bool(player.get("is_ready"))
            self._save_room(room)

    def set_wager(self, room_code: str, player_id: str, amount: int) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") == "playing":
                raise ValueError("对局进行中，无法修改押注")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            wager = max(0, min(int(amount or 0), MAX_WAGER))
            if not self._wager_is_affordable(player_id, wager):
                raise ValueError("当前总积分不足以设置该押注")
            player["wager"] = wager
            player["wager_set"] = True
            self._save_room(room)

    def update_cosmetics(self, room_code: str, player_id: str, cosmetics: Dict[str, Any] | None) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            player["cosmetics"] = self._sanitize_cosmetics(cosmetics)
            self._resolve_cosmetic_color_conflict(room, player_id)
            self._save_room(room)

    def add_chat_message(self, room_code: str, player_id: str, content: str, emoji: str = "") -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("Room not found")
            member = self._room_member(room, player_id)
            if not member:
                raise ValueError("Player is not in this room")
            text = str(content or "").strip()[:120]
            emoji_value = str(emoji or "").strip()[:8]
            if not text and not emoji_value:
                raise ValueError("Message is empty")
            entry = {
                "message_id": secrets.token_hex(6),
                "player_id": player_id,
                "display_name": str(member.get("display_name") or "玩家"),
                "avatar_url": str(member.get("avatar_url") or ""),
                "content": text,
                "emoji": emoji_value,
                "created_at": now_iso(),
                "role": "player" if self._find_player(room, player_id) else "spectator",
            }
            room.setdefault("chat_messages", []).append(entry)
            self._prune_chat_messages(room)
            return entry

    def add_marker(self, room_code: str, player_id: str, row: int, col: int, cosmetics: Dict[str, Any] | None = None) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("Room not found")
            spectator = self._find_spectator(room, player_id)
            if not spectator:
                raise ValueError("Only spectators can send hints")
            if row < 0 or row >= BOARD_SIZE or col < 0 or col >= BOARD_SIZE:
                raise ValueError("Marker position is invalid")
            payload = self._sanitize_cosmetics(cosmetics)
            entry = {
                "marker_id": secrets.token_hex(6),
                "player_id": player_id,
                "display_name": str(spectator.get("display_name") or "观众"),
                "row": int(row),
                "col": int(col),
                "icon_key": payload.get("icon_key", "triangle"),
                "color_key": payload.get("color_key", "classic"),
                "created_at": now_iso(),
            }
            room.setdefault("markers", []).append(entry)
            self._prune_markers(room)
            return entry

    def _check_win(self, board: List[List[int]], row: int, col: int, stone: int) -> bool:
        directions = [(1, 0), (0, 1), (1, 1), (1, -1)]
        for dx, dy in directions:
            count = 1
            for sign in (-1, 1):
                step = 1
                while True:
                    x = row + dx * step * sign
                    y = col + dy * step * sign
                    if x < 0 or x >= BOARD_SIZE or y < 0 or y >= BOARD_SIZE or board[x][y] != stone:
                        break
                    count += 1
                    step += 1
            if count >= 5:
                return True
        return False

    def start_match(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以开始")
            players = self._active_players(room)
            if len(players) != 2:
                raise ValueError("五子棋需要 2 名玩家")
            if not all(player.get("is_ready") for player in players):
                raise ValueError("两名玩家都准备后才能开始")
            if not all(player.get("wager_set") for player in players):
                raise ValueError("双方都需要先设置押注")
            for player in players:
                if not self._wager_is_affordable(player.get("player_id", ""), int(player.get("wager") or 0)):
                    raise ValueError(f"{self._player_label(player)} 的总积分不足以支付当前押注")
            self._begin_match(room, players)
            self._save_room(room)

    def restart_match(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以重开")
            if room.get("status") == "playing":
                raise ValueError("对局进行中，无法重开")
            players = self._active_players(room)
            if len(players) != 2:
                raise ValueError("五子棋需要 2 名玩家")
            for player in players:
                if not self._wager_is_affordable(player.get("player_id", ""), int(player.get("wager") or 0)):
                    raise ValueError(f"{self._player_label(player)} 的总积分不足以支付当前押注")
            self._begin_match(room, players)
            self._save_room(room)

    def place_stone(self, room_code: str, player_id: str, row: int, col: int) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在对局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你")
            if row < 0 or row >= BOARD_SIZE or col < 0 or col >= BOARD_SIZE:
                raise ValueError("落子位置非法")
            board = room.get("board") or self._default_board()
            if board[row][col] != 0:
                raise ValueError("该位置已有棋子")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            stone = int(player.get("stone") or 0)
            if stone not in (1, 2):
                raise ValueError("当前未分配棋色")
            board[row][col] = stone
            room["board"] = board
            room["move_count"] = int(room.get("move_count") or 0) + 1
            room["last_move"] = {"row": row, "col": col, "stone": stone, "player_id": player_id}
            players = self._active_players(room)
            if self._check_win(board, row, col, stone):
                opponent = next((candidate for candidate in players if candidate["player_id"] != player_id), None)
                self._finish_match(
                    room,
                    winner_player_id=player_id,
                    loser_player_id=str((opponent or {}).get("player_id") or ""),
                    reason="five_in_row",
                )
            elif room["move_count"] >= BOARD_SIZE * BOARD_SIZE:
                self._finish_match(room, winner_player_id="", loser_player_id="", reason="draw")
            else:
                for candidate in players:
                    if candidate["player_id"] != player_id:
                        room["turn_player_id"] = candidate["player_id"]
                        break
            self._save_room(room)

    def resign_match(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在对局中")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            opponent = next((candidate for candidate in self._active_players(room) if candidate["player_id"] != player_id), None)
            if not opponent:
                raise ValueError("当前没有可结算的对手")
            self._finish_match(
                room,
                winner_player_id=opponent["player_id"],
                loser_player_id=player_id,
                reason="resign",
            )
            self._save_room(room)


gomoku_manager = GomokuManager()


def init_gomoku_socketio(socketio, profile_resolver):
    def _emit_room(room_code: str) -> None:
        for snapshot in gomoku_manager.room_snapshots(room_code):
            emit("gomoku_room", snapshot["payload"], room=snapshot["sid"], namespace=ROOM_NAMESPACE)

    def _emit_rooms(target_sid: str | None = None) -> None:
        payload = gomoku_manager.room_summaries()
        if target_sid:
            socketio.emit("gomoku_rooms", payload, room=target_sid, namespace=ROOM_NAMESPACE)
            return
        socketio.emit("gomoku_rooms", payload, namespace=ROOM_NAMESPACE)

    @socketio.on("connect", namespace=ROOM_NAMESPACE)
    def gomoku_connect():
        emit("gomoku_connected", {"sid": request.sid})
        _emit_rooms(request.sid)

    @socketio.on("disconnect", namespace=ROOM_NAMESPACE)
    def gomoku_disconnect():
        affected_rooms = gomoku_manager.disconnect_player(request.sid)
        for room_code in affected_rooms:
            _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_join", namespace=ROOM_NAMESPACE)
    def gomoku_join(data):
        payload = dict(data or {})
        profile = profile_resolver(request)
        previous_rooms = gomoku_manager.rooms_for_player(profile["identity"])
        room_code = str(payload.get("room_code") or "").strip().upper()
        cosmetics = payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {}
        try:
            room_payload = gomoku_manager.create_or_join_room(
                ip=profile["identity"],
                player_id=profile["identity"],
                sid=request.sid,
                display_name=profile["display_name"],
                avatar_url=profile.get("avatar_url", ""),
                room_code=room_code or None,
                cosmetics=cosmetics,
                spectate=bool(payload.get("spectate")),
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        for previous_room_code in previous_rooms:
            if previous_room_code and previous_room_code != room_payload["room_code"]:
                leave_room(previous_room_code)
        join_room(room_payload["room_code"])
        emit("gomoku_room", room_payload)
        for previous_room_code in previous_rooms:
            if previous_room_code and previous_room_code != room_payload["room_code"]:
                _emit_room(previous_room_code)
        _emit_room(room_payload["room_code"])
        _emit_rooms()

    @socketio.on("gomoku_leave", namespace=ROOM_NAMESPACE)
    def gomoku_leave(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        room_payload = gomoku_manager.leave_room(room_code, profile_resolver(request)["identity"])
        leave_room(room_code)
        if room_payload:
            _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_toggle_ready", namespace=ROOM_NAMESPACE)
    def gomoku_toggle_ready(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.toggle_ready(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_switch_role", namespace=ROOM_NAMESPACE)
    def gomoku_switch_role(data):
        payload = dict(data or {})
        profile = profile_resolver(request)
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.switch_membership(
                room_code=room_code,
                ip=profile["identity"],
                player_id=profile["identity"],
                sid=request.sid,
                display_name=profile["display_name"],
                avatar_url=profile.get("avatar_url", ""),
                cosmetics=payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {},
                spectate=bool(payload.get("spectate")),
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_set_wager", namespace=ROOM_NAMESPACE)
    def gomoku_set_wager(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.set_wager(room_code, profile_resolver(request)["identity"], int(payload.get("wager") or 0))
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_update_cosmetics", namespace=ROOM_NAMESPACE)
    def gomoku_update_cosmetics(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.update_cosmetics(
                room_code,
                profile_resolver(request)["identity"],
                payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {},
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_start", namespace=ROOM_NAMESPACE)
    def gomoku_start(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.start_match(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_rematch", namespace=ROOM_NAMESPACE)
    def gomoku_rematch(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.restart_match(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_resign", namespace=ROOM_NAMESPACE)
    def gomoku_resign(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.resign_match(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
        _emit_rooms()

    @socketio.on("gomoku_place", namespace=ROOM_NAMESPACE)
    def gomoku_place(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.place_stone(
                room_code,
                profile_resolver(request)["identity"],
                int(payload.get("row")),
                int(payload.get("col")),
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)

    @socketio.on("gomoku_ping", namespace=ROOM_NAMESPACE)
    def gomoku_ping(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.add_marker(
                room_code,
                profile_resolver(request)["identity"],
                int(payload.get("row")),
                int(payload.get("col")),
                payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {},
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)

    @socketio.on("gomoku_chat", namespace=ROOM_NAMESPACE)
    def gomoku_chat(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            gomoku_manager.add_chat_message(
                room_code,
                profile_resolver(request)["identity"],
                str(payload.get("content") or ""),
                str(payload.get("emoji") or ""),
            )
        except Exception as exc:
            emit("gomoku_error", {"error": str(exc)})
            return
        _emit_room(room_code)
