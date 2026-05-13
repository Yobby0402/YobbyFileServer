from __future__ import annotations

import secrets
import threading
from typing import Any, Dict, List

from flask import request
from flask_socketio import emit, join_room, leave_room

from .game_hub import GameHubStore, now_iso

ROOM_NAMESPACE = "/games-gomoku"
ROOM_TYPE = "gomoku"
BOARD_SIZE = 15


class GomokuManager:
    def __init__(self, store: GameHubStore | None = None) -> None:
        self._lock = threading.RLock()
        self._store = store or GameHubStore()
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._load_rooms()

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
            state.setdefault("board", [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)])
            state.setdefault("host_player_id", players[0].get("player_id", ""))
            state.setdefault("turn_player_id", "")
            state.setdefault("winner_player_id", "")
            state.setdefault("winner_label", "")
            state.setdefault("move_count", 0)
            state.setdefault("match_index", 0)
            state.setdefault("history", [])
            for player in players:
                player["sid"] = ""
                player["is_online"] = False
                player.setdefault("is_ready", False)
                player.setdefault("stone", 0)
                player["cosmetics"] = self._sanitize_cosmetics(player.get("cosmetics"))
                player.setdefault("joined_at", now_iso())
                player.setdefault("last_seen", now_iso())
            self._rooms[room_code] = state

    def _save_room(self, room: Dict[str, Any]) -> None:
        room["updated_at"] = now_iso()
        self._store.save_room_state(ROOM_TYPE, room["room_code"], room)

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

    def _find_player(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return next((item for item in room["players"] if item["player_id"] == player_id and not item.get("removed")), None)

    def _reset_match_state(self, room: Dict[str, Any], preserve_history: bool = True) -> None:
        room["status"] = "lobby"
        room["board"] = [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]
        room["turn_player_id"] = ""
        room["winner_player_id"] = ""
        room["winner_label"] = ""
        room["last_move"] = {}
        room["move_count"] = 0
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
        if len(active_players) < 2:
            self._reset_match_state(room, preserve_history=True)
        elif room.get("turn_player_id") == player_id:
            for candidate in active_players:
                if candidate["player_id"] != player_id:
                    room["turn_player_id"] = candidate["player_id"]
                    break
        self._save_room(room)
        return True

    def _player_label(self, player: Dict[str, Any]) -> str:
        return str(player.get("display_name") or "玩家")

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
                if self._find_player(room, player_id):
                    codes.append(room_code)
            return codes

    def _public_room(self, room: Dict[str, Any], viewer_player_id: str | None = None) -> Dict[str, Any]:
        players = []
        for player in self._active_players(room):
            players.append(
                {
                    "player_id": player["player_id"],
                    "display_name": player["display_name"],
                    "avatar_url": player.get("avatar_url", ""),
                    "is_online": bool(player.get("is_online")),
                    "is_ready": bool(player.get("is_ready")),
                    "stone": int(player.get("stone") or 0),
                    "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
                    "joined_at": player.get("joined_at", ""),
                }
            )
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
            "board": room.get("board") or [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)],
            "history": list(room.get("history") or []),
            "players": players,
            "player_count": len(players),
            "online_count": sum(1 for player in players if player.get("is_online")),
        }
        payload["can_start"] = len(players) == 2 and all(player.get("is_ready") for player in players)
        if viewer_player_id:
            player = self._find_player(room, viewer_player_id)
            payload["self_player_id"] = viewer_player_id
            payload["self_stone"] = int((player or {}).get("stone") or 0)
        return payload

    def room_snapshots(self, room_code: str) -> List[Dict[str, Any]]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return []
            snapshots = []
            for player in self._active_players(room):
                sid = str(player.get("sid") or "").strip()
                if not sid:
                    continue
                snapshots.append({"sid": sid, "payload": self._public_room(room, player["player_id"])})
            return snapshots

    def room_summaries(self) -> List[Dict[str, Any]]:
        with self._lock:
            items = []
            for room_code, room in sorted(self._rooms.items(), key=lambda item: (item[1].get("updated_at", ""), item[0]), reverse=True):
                players = self._active_players(room)
                if not players:
                    continue
                items.append(
                    {
                        "room_code": room_code,
                        "status": room.get("status", "lobby"),
                        "match_index": int(room.get("match_index") or 0),
                        "players": [
                            {
                                "player_id": player["player_id"],
                                "display_name": player["display_name"],
                                "is_online": bool(player.get("is_online")),
                                "is_ready": bool(player.get("is_ready")),
                                "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
                            }
                            for player in players
                        ],
                        "player_count": len(players),
                        "online_count": sum(1 for player in players if player.get("is_online")),
                        "updated_at": room.get("updated_at", ""),
                    }
                )
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
                    "status": "lobby",
                    "board": [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)],
                    "turn_player_id": "",
                    "winner_player_id": "",
                    "winner_label": "",
                    "last_move": {},
                    "move_count": 0,
                    "match_index": 0,
                    "history": [],
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                self._rooms[code] = room

            for other_room_code, other_room in list(self._rooms.items()):
                if other_room_code == code:
                    continue
                if self._find_player(other_room, player_id_value):
                    self._remove_player_from_room(other_room, player_id_value, mark_removed=True)

            active_players = self._active_players(room)
            player = self._find_player(room, player_id_value)
            if player is None:
                if len(active_players) >= 2:
                    raise ValueError("房间已满")
                room["players"].append(
                    {
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
                        "cosmetics": self._sanitize_cosmetics(cosmetics),
                    }
                )
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
            if not player:
                return self._public_room(room, "")
            active_players = self._active_players(room)
            if not active_players:
                return None
            self._remove_player_from_room(room, player_id, mark_removed=True)
            refreshed = self._rooms.get(room["room_code"])
            if not refreshed:
                return None
            remaining_players = self._active_players(refreshed)
            return self._public_room(refreshed, remaining_players[0]["player_id"] if remaining_players else "")

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
            board = room.get("board") or [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]
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
                room["status"] = "finished"
                room["winner_player_id"] = player_id
                room["winner_label"] = self._player_label(player)
                room["history"] = (room.get("history") or [])[-11:] + [{
                    "match_index": int(room.get("match_index") or 0),
                    "winner_player_id": player_id,
                    "winner_label": self._player_label(player),
                    "move_count": room["move_count"],
                    "finished_at": now_iso(),
                }]
            elif room["move_count"] >= BOARD_SIZE * BOARD_SIZE:
                room["status"] = "finished"
                room["winner_player_id"] = ""
                room["winner_label"] = "平局"
                room["history"] = (room.get("history") or [])[-11:] + [{
                    "match_index": int(room.get("match_index") or 0),
                    "winner_player_id": "",
                    "winner_label": "平局",
                    "move_count": room["move_count"],
                    "finished_at": now_iso(),
                }]
            else:
                for candidate in players:
                    if candidate["player_id"] != player_id:
                        room["turn_player_id"] = candidate["player_id"]
                        break
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
