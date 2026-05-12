from __future__ import annotations

import secrets
import threading
from datetime import datetime
from typing import Any, Dict, List

from flask import request
from flask_socketio import emit, join_room, leave_room

from .game_hub import GameHubStore, now_iso

ROOM_NAMESPACE = "/games-drawphone"
ROOM_TYPE = "drawphone"


class DrawphoneManager:
    def __init__(self, store: GameHubStore | None = None) -> None:
        self._lock = threading.RLock()
        self._store = store or GameHubStore()
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._load_rooms()

    def _load_rooms(self) -> None:
        for item in self._store.list_room_states(ROOM_TYPE):
            state = item.get("state") or {}
            room_code = str(state.get("room_code") or item.get("room_code") or "").strip().upper()
            if not room_code:
                continue
            players = state.get("players")
            if not isinstance(players, list) or not players:
                continue
            state["room_code"] = room_code
            state.setdefault("stage", "lobby")
            state.setdefault("created_at", now_iso())
            state.setdefault("updated_at", now_iso())
            state.setdefault("round_index", 0)
            state.setdefault("round_history", [])
            state.setdefault("current_round", {})
            state.setdefault("host_player_id", players[0].get("player_id", ""))
            for player in players:
                player["sid"] = ""
                player["is_online"] = False
                player.setdefault("is_ready", False)
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

    def player_sid(self, room_code: str, player_id: str) -> str:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return ""
            player = self._find_player(room, player_id)
            return str((player or {}).get("sid") or "")

    def _viewer_state(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any]:
        current_round = room.get("current_round") or {}
        states = current_round.get("states") or {}
        return dict(states.get(player_id) or {})

    def _public_room(self, room: Dict[str, Any], viewer_player_id: str | None = None) -> Dict[str, Any]:
        current_round = room.get("current_round") or {}
        states = current_round.get("states") or {}
        players = []
        for player in self._active_players(room):
            player_state = states.get(player["player_id"]) or {}
            players.append(
                {
                    "player_id": player["player_id"],
                    "sid": player.get("sid", ""),
                    "ip": player["ip"],
                    "display_name": player["display_name"],
                    "avatar_url": player.get("avatar_url", ""),
                    "joined_at": player["joined_at"],
                    "last_seen": player.get("last_seen", ""),
                    "is_online": bool(player.get("is_online")),
                    "is_ready": bool(player.get("is_ready")),
                    "phase": player_state.get("phase", room.get("stage", "lobby")),
                    "submitted_prompt": bool(player_state.get("submitted_prompt")),
                    "submitted_drawing": bool(player_state.get("submitted_drawing")),
                    "submitted_caption": bool(player_state.get("submitted_caption")),
                }
            )
        payload = {
            "room_code": room["room_code"],
            "stage": room.get("stage", "lobby"),
            "host_player_id": room.get("host_player_id", ""),
            "players": players,
            "created_at": room.get("created_at", ""),
            "updated_at": room.get("updated_at", ""),
            "round_index": int(room.get("round_index") or 0),
            "round_history": list(room.get("round_history") or []),
            "results": list((current_round or {}).get("results") or []),
            "online_count": sum(1 for player in players if player.get("is_online")),
            "can_start": len(players) >= 2 and all(player.get("is_ready") for player in players),
        }
        if viewer_player_id:
            payload["self_player_id"] = viewer_player_id
            payload["self_turn"] = self._viewer_state(room, viewer_player_id)
        return payload

    def room_snapshots(self, room_code: str) -> List[Dict[str, Any]]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return []
            snapshots: List[Dict[str, Any]] = []
            for player in self._active_players(room):
                sid = str(player.get("sid") or "").strip()
                if not sid:
                    continue
                snapshots.append({"sid": sid, "payload": self._public_room(room, player["player_id"])})
            return snapshots

    def room_summaries(self) -> List[Dict[str, Any]]:
        with self._lock:
            items: List[Dict[str, Any]] = []
            for room_code, room in sorted(self._rooms.items(), key=lambda item: (item[1].get("updated_at", ""), item[0]), reverse=True):
                players = self._active_players(room)
                if not players:
                    continue
                items.append(
                    {
                        "room_code": room_code,
                        "stage": room.get("stage", "lobby"),
                        "round_index": int(room.get("round_index") or 0),
                        "host_player_id": room.get("host_player_id", ""),
                        "players": [
                            {
                                "player_id": player["player_id"],
                                "display_name": player["display_name"],
                                "is_online": bool(player.get("is_online")),
                                "is_ready": bool(player.get("is_ready")),
                            }
                            for player in players
                        ],
                        "player_count": len(players),
                        "online_count": sum(1 for player in players if player.get("is_online")),
                        "updated_at": room.get("updated_at", ""),
                        "can_resume": room.get("stage") in {"prompt", "draw", "caption"},
                    }
                )
            return items

    def _new_round_state(self, room: Dict[str, Any]) -> Dict[str, Any]:
        players = self._active_players(room)
        room["round_index"] = int(room.get("round_index") or 0) + 1
        return {
            "round_index": room["round_index"],
            "started_at": now_iso(),
            "completed_at": "",
            "results": [],
            "states": {
                player["player_id"]: {
                    "phase": "prompt",
                    "prompt": "",
                    "draw_for_player_id": "",
                    "draw_for_prompt": "",
                    "drawing": "",
                    "caption_for_player_id": "",
                    "caption_for_drawing": "",
                    "caption": "",
                    "submitted_prompt": False,
                    "submitted_drawing": False,
                    "submitted_caption": False,
                    "submitted_at": "",
                }
                for player in players
            },
        }

    def _advance_to_draw(self, room: Dict[str, Any]) -> None:
        players = self._active_players(room)
        current_round = room["current_round"]
        states = current_round["states"]
        room["stage"] = "draw"
        for index, player in enumerate(players):
            target = players[(index - 1) % len(players)]
            state = states[player["player_id"]]
            state["phase"] = "draw"
            state["draw_for_player_id"] = target["player_id"]
            state["draw_for_prompt"] = states[target["player_id"]]["prompt"]
            state["submitted_at"] = ""

    def _advance_to_caption(self, room: Dict[str, Any]) -> None:
        players = self._active_players(room)
        current_round = room["current_round"]
        states = current_round["states"]
        room["stage"] = "caption"
        for index, player in enumerate(players):
            target = players[(index - 1) % len(players)]
            state = states[player["player_id"]]
            state["phase"] = "caption"
            state["caption_for_player_id"] = target["player_id"]
            state["caption_for_drawing"] = states[target["player_id"]]["drawing"]
            state["submitted_at"] = ""

    def _finish_round(self, room: Dict[str, Any]) -> None:
        players = self._active_players(room)
        current_round = room["current_round"]
        states = current_round["states"]
        room["stage"] = "reveal"
        current_round["completed_at"] = now_iso()
        current_round["results"] = []
        for player in players:
            owner_id = player["player_id"]
            drawing_player = next(
                (
                    candidate["player_id"]
                    for candidate in players
                    if states[candidate["player_id"]]["draw_for_player_id"] == owner_id
                ),
                owner_id,
            )
            caption_player = next(
                (
                    candidate["player_id"]
                    for candidate in players
                    if states[candidate["player_id"]]["caption_for_player_id"] == drawing_player
                ),
                owner_id,
            )
            current_round["results"].append(
                {
                    "prompt_owner_id": owner_id,
                    "prompt_owner_name": next(item["display_name"] for item in players if item["player_id"] == owner_id),
                    "prompt": states[owner_id]["prompt"],
                    "drawing_player_id": drawing_player,
                    "drawing_player_name": next(item["display_name"] for item in players if item["player_id"] == drawing_player),
                    "drawing": states[drawing_player]["drawing"],
                    "caption_player_id": caption_player,
                    "caption_player_name": next(item["display_name"] for item in players if item["player_id"] == caption_player),
                    "caption": states[caption_player]["caption"],
                }
            )
        room["round_history"] = (room.get("round_history") or [])[-11:] + [
            {
                "round_index": current_round["round_index"],
                "completed_at": current_round["completed_at"],
                "results": current_round["results"],
            }
        ]
        for player in players:
            player["is_ready"] = False

    def create_or_join_room(
        self,
        ip: str,
        player_id: str,
        sid: str,
        display_name: str,
        avatar_url: str = "",
        room_code: str | None = None,
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
                    "stage": "lobby",
                    "round_index": 0,
                    "round_history": [],
                    "current_round": {},
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                self._rooms[code] = room

            player = self._find_player(room, player_id_value)
            if player is None:
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
                    }
                )
            else:
                player["sid"] = sid
                player["ip"] = ip
                player["display_name"] = display_name
                player["avatar_url"] = avatar_url
                player["last_seen"] = now_iso()
                player["is_online"] = True

            if not self._find_player(room, room.get("host_player_id", "")):
                first = self._active_players(room)[0]
                room["host_player_id"] = first["player_id"]
            self._save_room(room)
            return self._public_room(room, player_id_value)

    def disconnect_player(self, sid: str) -> List[str]:
        with self._lock:
            affected: List[str] = []
            for room_code, room in self._rooms.items():
                player = next((item for item in self._active_players(room) if item.get("sid") == sid), None)
                if not player:
                    continue
                player["sid"] = ""
                player["is_online"] = False
                player["last_seen"] = now_iso()
                self._save_room(room)
                affected.append(room_code)
            return affected

    def leave_room(self, room_code: str, player_id: str) -> Dict[str, Any] | None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return None
            room["players"] = [item for item in room["players"] if item["player_id"] != player_id]
            current_round = room.get("current_round") or {}
            states = current_round.get("states") or {}
            states.pop(player_id, None)
            if not self._active_players(room):
                self._delete_room(room["room_code"])
                return None
            if room.get("stage") in {"prompt", "draw", "caption"}:
                room["stage"] = "lobby"
                room["current_round"] = {}
                for player in self._active_players(room):
                    player["is_ready"] = False
            if room.get("host_player_id") == player_id:
                room["host_player_id"] = self._active_players(room)[0]["player_id"]
            self._save_room(room)
            return self._public_room(room)

    def toggle_ready(self, room_code: str, player_id: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("stage") not in {"lobby", "reveal"}:
                raise ValueError("当前阶段不能切换准备状态")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间内")
            player["is_ready"] = not bool(player.get("is_ready"))
            player["last_seen"] = now_iso()
            self._save_room(room)
            return self._public_room(room, player_id)

    def kick_player(self, room_code: str, host_player_id: str, target_player_id: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != host_player_id:
                raise ValueError("只有房主可以踢人")
            if host_player_id == target_player_id:
                raise ValueError("不能踢出自己")
            if room.get("stage") in {"prompt", "draw", "caption"}:
                raise ValueError("进行中的回合不能踢人，请等本轮结束")
            player = self._find_player(room, target_player_id)
            if not player:
                raise ValueError("目标玩家不存在")
            player["removed"] = True
            player["is_online"] = False
            player["sid"] = ""
            current_round = room.get("current_round") or {}
            states = current_round.get("states") or {}
            states.pop(target_player_id, None)
            room["players"] = [item for item in room["players"] if not item.get("removed")]
            if room.get("host_player_id") == target_player_id and self._active_players(room):
                room["host_player_id"] = self._active_players(room)[0]["player_id"]
            self._save_room(room)
            return self._public_room(room, host_player_id)

    def start_round(self, room_code: str, player_id: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以开始")
            players = self._active_players(room)
            if len(players) < 2:
                raise ValueError("至少需要两名玩家")
            if room.get("stage") in {"prompt", "draw", "caption"}:
                raise ValueError("当前回合尚未结束")
            if not all(player_item.get("is_ready") for player_item in players):
                raise ValueError("所有玩家准备后才能开始")
            room["current_round"] = self._new_round_state(room)
            room["stage"] = "prompt"
            for player_item in players:
                player_item["is_ready"] = False
            self._save_room(room)
            return self._public_room(room, player_id)

    def submit_prompt(self, room_code: str, player_id: str, prompt: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room or room.get("stage") != "prompt":
                raise ValueError("当前不在提示词阶段")
            state = ((room.get("current_round") or {}).get("states") or {}).get(player_id)
            if not state:
                raise ValueError("玩家不在房间内")
            if state.get("submitted_prompt"):
                raise ValueError("提示词已经提交过了")
            prompt_value = str(prompt or "").strip()[:120]
            if not prompt_value:
                raise ValueError("提示词不能为空")
            state["prompt"] = prompt_value
            state["submitted_prompt"] = True
            state["submitted_at"] = now_iso()
            round_states = (room.get("current_round") or {}).get("states") or {}
            if all(item.get("submitted_prompt") and item.get("prompt") for item in round_states.values()):
                self._advance_to_draw(room)
            self._save_room(room)
            return self._public_room(room, player_id)

    def submit_drawing(self, room_code: str, player_id: str, drawing_data_url: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room or room.get("stage") != "draw":
                raise ValueError("当前不在绘图阶段")
            state = ((room.get("current_round") or {}).get("states") or {}).get(player_id)
            if not state:
                raise ValueError("玩家不在房间内")
            if state.get("submitted_drawing"):
                raise ValueError("绘图已经提交过了")
            drawing_value = str(drawing_data_url or "")[:2_000_000]
            if not drawing_value.startswith("data:image/"):
                raise ValueError("绘图数据无效")
            state["drawing"] = drawing_value
            state["submitted_drawing"] = True
            state["submitted_at"] = now_iso()
            round_states = (room.get("current_round") or {}).get("states") or {}
            if all(item.get("submitted_drawing") and item.get("drawing") for item in round_states.values()):
                self._advance_to_caption(room)
            self._save_room(room)
            return self._public_room(room, player_id)

    def submit_caption(self, room_code: str, player_id: str, caption: str) -> Dict[str, Any]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room or room.get("stage") != "caption":
                raise ValueError("当前不在描述阶段")
            state = ((room.get("current_round") or {}).get("states") or {}).get(player_id)
            if not state:
                raise ValueError("玩家不在房间内")
            if state.get("submitted_caption"):
                raise ValueError("描述已经提交过了")
            caption_value = str(caption or "").strip()[:120]
            if not caption_value:
                raise ValueError("描述不能为空")
            state["caption"] = caption_value
            state["submitted_caption"] = True
            state["submitted_at"] = now_iso()
            round_states = (room.get("current_round") or {}).get("states") or {}
            if all(item.get("submitted_caption") and item.get("caption") for item in round_states.values()):
                self._finish_round(room)
            self._save_room(room)
            return self._public_room(room, player_id)


drawphone_manager = DrawphoneManager()


def init_drawphone_socketio(socketio, profile_resolver):
    sid_to_player: Dict[str, str] = {}
    sid_lock = threading.RLock()

    def bind_sid(sid: str, player_id: str) -> None:
        with sid_lock:
            sid_to_player[sid] = player_id

    def unbind_sid(sid: str) -> str:
        with sid_lock:
            return sid_to_player.pop(sid, "")

    def current_player_id(sid: str, data: Dict[str, Any] | None = None) -> str:
        payload = data or {}
        hinted = str(payload.get("player_id") or "").strip()[:64]
        if hinted:
            bind_sid(sid, hinted)
            return hinted
        with sid_lock:
            return sid_to_player.get(sid, "")

    def emit_room_state(room_code: str) -> None:
        for snapshot in drawphone_manager.room_snapshots(room_code):
            emit("drawphone_room", snapshot["payload"], room=snapshot["sid"], namespace=ROOM_NAMESPACE)

    def emit_room_list(target_sid: str | None = None) -> None:
        payload = drawphone_manager.room_summaries()
        if target_sid:
            socketio.emit("drawphone_rooms", payload, room=target_sid, namespace=ROOM_NAMESPACE)
            return
        socketio.emit("drawphone_rooms", payload, namespace=ROOM_NAMESPACE)

    @socketio.on("connect", namespace=ROOM_NAMESPACE)
    def drawphone_connect():
        emit("drawphone_connected", {"sid": request.sid})
        emit_room_list(request.sid)

    @socketio.on("disconnect", namespace=ROOM_NAMESPACE)
    def drawphone_disconnect():
        unbind_sid(request.sid)
        affected_rooms = drawphone_manager.disconnect_player(request.sid)
        for room_code in affected_rooms:
            emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_join", namespace=ROOM_NAMESPACE)
    def drawphone_join(data):
        payload = data or {}
        player_id = current_player_id(request.sid, payload)
        profile = profile_resolver(request)
        try:
            room_payload = drawphone_manager.create_or_join_room(
                profile["ip"],
                player_id=player_id,
                sid=request.sid,
                display_name=profile["display_name"],
                avatar_url=profile.get("avatar_url", ""),
                room_code=payload.get("room_code"),
            )
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        room_code = room_payload["room_code"]
        join_room(room_code)
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_leave", namespace=ROOM_NAMESPACE)
    def drawphone_leave(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        leave_room(room_code)
        room_payload = drawphone_manager.leave_room(room_code, player_id)
        if room_payload:
            emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_toggle_ready", namespace=ROOM_NAMESPACE)
    def drawphone_toggle_ready(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        try:
            drawphone_manager.toggle_ready(room_code, player_id)
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_kick", namespace=ROOM_NAMESPACE)
    def drawphone_kick(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        host_player_id = current_player_id(request.sid, payload)
        target_player_id = str(payload.get("target_player_id") or "").strip()[:64]
        target_sid = drawphone_manager.player_sid(room_code, target_player_id)
        try:
            drawphone_manager.kick_player(room_code, host_player_id, target_player_id)
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        if target_sid:
            emit(
                "drawphone_kicked",
                {"room_code": room_code, "target_player_id": target_player_id},
                room=target_sid,
                namespace=ROOM_NAMESPACE,
            )
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_start", namespace=ROOM_NAMESPACE)
    def drawphone_start(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        try:
            drawphone_manager.start_round(room_code, player_id)
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_submit_prompt", namespace=ROOM_NAMESPACE)
    def drawphone_submit_prompt(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        try:
            drawphone_manager.submit_prompt(room_code, player_id, payload.get("prompt"))
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_submit_drawing", namespace=ROOM_NAMESPACE)
    def drawphone_submit_drawing(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        try:
            drawphone_manager.submit_drawing(room_code, player_id, payload.get("drawing"))
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        emit_room_state(room_code)
        emit_room_list()

    @socketio.on("drawphone_submit_caption", namespace=ROOM_NAMESPACE)
    def drawphone_submit_caption(data):
        payload = data or {}
        room_code = str(payload.get("room_code") or "").strip().upper()
        player_id = current_player_id(request.sid, payload)
        try:
            drawphone_manager.submit_caption(room_code, player_id, payload.get("caption"))
        except ValueError as exc:
            emit("drawphone_error", {"error": str(exc)})
            return
        emit_room_state(room_code)
        emit_room_list()
