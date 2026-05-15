from __future__ import annotations

import secrets
import threading
from typing import Any, Dict, List

from flask import request
from flask_socketio import join_room

from .game_hub import GameHubStore, format_visitor_label, now_iso

CHAT_NAMESPACE = "/games-chat"
CHAT_ROOM_TYPE = "games-chat"
CHAT_ROOM_CODE = "GLOBAL"
CHAT_ROOM_NAME = "games-chat:GLOBAL"
MAX_CHAT_MESSAGES = 50
MAX_CHAT_LENGTH = 160


class GamesChatManager:
    def __init__(self, store: GameHubStore | None = None) -> None:
        self._store = store or GameHubStore()
        self._lock = threading.RLock()

    def _normalize_message(self, payload: Any) -> Dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None
        content = " ".join(str(payload.get("content") or "").split())
        if not content:
            return None
        return {
            "message_id": str(payload.get("message_id") or "").strip()[:48] or f"msg-{secrets.token_hex(8)}",
            "client_message_id": str(payload.get("client_message_id") or "").strip()[:64],
            "player_id": str(payload.get("player_id") or "").strip()[:64],
            "display_name": str(payload.get("display_name") or "").strip()[:32] or "玩家",
            "avatar_url": str(payload.get("avatar_url") or "").strip()[:240],
            "content": content[:MAX_CHAT_LENGTH],
            "created_at": str(payload.get("created_at") or now_iso()).strip()[:40],
            "current_game": str(payload.get("current_game") or "").strip()[:64],
            "current_game_label": str(payload.get("current_game_label") or "").strip()[:32],
        }

    def _load_messages(self) -> List[Dict[str, Any]]:
        state = self._store.get_room_state(CHAT_ROOM_TYPE, CHAT_ROOM_CODE).get("state") or {}
        raw_messages = state.get("messages") if isinstance(state, dict) else []
        messages: List[Dict[str, Any]] = []
        for entry in raw_messages if isinstance(raw_messages, list) else []:
            normalized = self._normalize_message(entry)
            if normalized:
                messages.append(normalized)
        return messages[-MAX_CHAT_MESSAGES:]

    def _save_messages(self, messages: List[Dict[str, Any]]) -> None:
        self._store.save_room_state(
            CHAT_ROOM_TYPE,
            CHAT_ROOM_CODE,
            {"messages": list(messages)[-MAX_CHAT_MESSAGES:]},
        )

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            return self._load_messages()

    def add_message(
        self,
        *,
        profile: Dict[str, Any],
        content: Any,
        current_game: Any = "",
        current_game_label: Any = "",
        client_message_id: Any = "",
    ) -> Dict[str, Any]:
        text = " ".join(str(content or "").split())
        if not text:
            raise ValueError("消息不能为空")
        player_id = str(profile.get("identity") or "").strip()[:64]
        display_name = str(profile.get("display_name") or profile.get("nickname") or "").strip()[:32]
        message = self._normalize_message({
            "message_id": f"msg-{secrets.token_hex(8)}",
            "client_message_id": str(client_message_id or "").strip()[:64],
            "player_id": player_id,
            "display_name": display_name or format_visitor_label(player_id),
            "avatar_url": str(profile.get("avatar_url") or "").strip(),
            "content": text,
            "created_at": now_iso(),
            "current_game": current_game,
            "current_game_label": current_game_label,
        })
        if not message:
            raise ValueError("消息不能为空")
        with self._lock:
            messages = self._load_messages()
            messages.append(message)
            self._save_messages(messages)
        return message


def init_games_chat_socketio(socketio, profile_resolver):
    manager = GamesChatManager()

    @socketio.on("games_chat_join", namespace=CHAT_NAMESPACE)
    def games_chat_join(_payload=None):
        join_room(CHAT_ROOM_NAME)
        socketio.emit(
            "games_chat_snapshot",
            {"messages": manager.snapshot()},
            room=request.sid,
            namespace=CHAT_NAMESPACE,
        )

    @socketio.on("games_chat_send", namespace=CHAT_NAMESPACE)
    def games_chat_send(payload):
        data = dict(payload or {})
        try:
            message = manager.add_message(
                profile=profile_resolver(request),
                content=data.get("content"),
                current_game=data.get("current_game"),
                current_game_label=data.get("current_game_label"),
                client_message_id=data.get("client_message_id"),
            )
        except Exception as exc:
            socketio.emit("games_chat_error", {"error": str(exc)}, room=request.sid, namespace=CHAT_NAMESPACE)
            return
        socketio.emit("games_chat_message", message, room=CHAT_ROOM_NAME, namespace=CHAT_NAMESPACE)
