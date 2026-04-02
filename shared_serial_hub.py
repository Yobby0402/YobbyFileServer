from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple


DEFAULT_RECENT_LIMIT = 500
DEFAULT_HISTORY_PAGE_SIZE = 200
DEFAULT_SEGMENT_ENTRY_LIMIT = 1000
DEFAULT_SEGMENT_BYTE_LIMIT = 1024 * 1024

STATE_STANDBY = "standby"
STATE_ACTIVATING = "activating"
STATE_ACTIVE = "active"
STATE_OFFLINE = "offline"

SOURCE_SERVER_PYSERIAL = "server_pyserial"
SOURCE_BROWSER_SERIAL = "browser_serial"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SharedSerialHub:
    def __init__(
        self,
        recent_limit: int = DEFAULT_RECENT_LIMIT,
        page_size: int = DEFAULT_HISTORY_PAGE_SIZE,
        segment_entry_limit: int = DEFAULT_SEGMENT_ENTRY_LIMIT,
        segment_byte_limit: int = DEFAULT_SEGMENT_BYTE_LIMIT,
    ) -> None:
        self.recent_limit = max(50, int(recent_limit))
        self.page_size = max(1, int(page_size))
        self.segment_entry_limit = max(100, int(segment_entry_limit))
        self.segment_byte_limit = max(4096, int(segment_byte_limit))
        self._lock = threading.RLock()
        self.channels: Dict[str, Dict] = {}
        self.socket_subscriptions: Dict[str, Set[str]] = {}
        self.owner_channels: Dict[str, Set[str]] = {}
        self.pending_writes: Dict[str, Dict] = {}

        self.history_root = os.path.join(self._get_base_dir(), "logs", "shared_serial_history")
        os.makedirs(self.history_root, exist_ok=True)

    # ------------------------------------------------------------------ #
    # Channel lifecycle
    # ------------------------------------------------------------------ #
    def ensure_server_channel(
        self,
        device: str,
        config: Dict,
        display_name: Optional[str] = None,
    ) -> Tuple[Dict, bool]:
        normalized = self._normalize_config(config)
        channel_id = self._build_server_channel_id(device, normalized)

        with self._lock:
            created = channel_id not in self.channels
            if created:
                channel = self._create_channel(
                    channel_id=channel_id,
                    source_type=SOURCE_SERVER_PYSERIAL,
                    device=device,
                    display_name=display_name or device,
                    config=normalized,
                    owner_sid=None,
                    owner_label=None,
                    browser_port=None,
                )
                self.channels[channel_id] = channel
            else:
                channel = self.channels[channel_id]
                channel["device"] = device
                channel["display_name"] = display_name or channel.get("display_name") or device
                channel["config"] = normalized
                channel["updated_at"] = _utcnow_iso()
            return self._serialize_channel(channel), created

    def register_browser_channel(
        self,
        owner_sid: str,
        display_name: str,
        config: Dict,
        browser_port: Optional[Dict] = None,
    ) -> Dict:
        normalized = self._normalize_config(config)
        channel_id = f"shared_web_{uuid.uuid4().hex[:12]}"
        label = (display_name or "").strip() or self._default_browser_label(browser_port)

        with self._lock:
            channel = self._create_channel(
                channel_id=channel_id,
                source_type=SOURCE_BROWSER_SERIAL,
                device=label,
                display_name=label,
                config=normalized,
                owner_sid=owner_sid,
                owner_label=label,
                browser_port=browser_port or {},
            )
            self.channels[channel_id] = channel
            self.owner_channels.setdefault(owner_sid, set()).add(channel_id)
            return self._serialize_channel(channel)

    def attach_client(self, channel_id: str, sid: str) -> Tuple[Optional[Dict], List[Dict], Optional[str]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None, [], "channel_not_found"
            if channel["source_type"] == SOURCE_BROWSER_SERIAL and channel["state"] == STATE_OFFLINE:
                return None, [], "channel_offline"

            channel["subscribers"].add(sid)
            self.socket_subscriptions.setdefault(sid, set()).add(channel_id)
            channel["updated_at"] = _utcnow_iso()

            actions = self._activation_actions_locked(channel)
            return self._serialize_channel(channel), actions, None

    def detach_client(self, channel_id: str, sid: str) -> Tuple[Optional[Dict], List[Dict]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None, []

            channel["subscribers"].discard(sid)
            if sid in self.socket_subscriptions:
                self.socket_subscriptions[sid].discard(channel_id)
                if not self.socket_subscriptions[sid]:
                    self.socket_subscriptions.pop(sid, None)

            channel["updated_at"] = _utcnow_iso()
            actions = self._sleep_actions_locked(channel)
            return self._serialize_channel(channel), actions

    def unregister_browser_channel(
        self,
        owner_sid: str,
        channel_id: str,
        reason: str = "owner_request",
    ) -> Tuple[Optional[Dict], List[Dict]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel or channel["source_type"] != SOURCE_BROWSER_SERIAL:
                return None, []
            if channel.get("owner_sid") != owner_sid:
                return None, []

            actions = []
            if channel["state"] in (STATE_ACTIVE, STATE_ACTIVATING):
                actions.append(
                    {
                        "type": "browser_sleep",
                        "channel_id": channel_id,
                        "owner_sid": owner_sid,
                    }
                )

            if channel["capture"]["active"]:
                self._stop_capture_locked(channel, reason)

            self._close_history_handle_locked(channel)
            self._clear_pending_writes_locked(channel_id)
            self.owner_channels.get(owner_sid, set()).discard(channel_id)
            if owner_sid in self.owner_channels and not self.owner_channels[owner_sid]:
                self.owner_channels.pop(owner_sid, None)

            removed = self.channels.pop(channel_id, None)
            if not removed:
                return None, actions

            for sid, channels in list(self.socket_subscriptions.items()):
                if channel_id in channels:
                    channels.discard(channel_id)
                if not channels:
                    self.socket_subscriptions.pop(sid, None)

            return self._serialize_channel(removed), actions

    def handle_socket_disconnect(self, sid: str) -> Tuple[List[Dict], List[Dict]]:
        changed: List[Dict] = []
        actions: List[Dict] = []

        with self._lock:
            attached_channels = list(self.socket_subscriptions.pop(sid, set()))
            for channel_id in attached_channels:
                channel = self.channels.get(channel_id)
                if not channel:
                    continue
                channel["subscribers"].discard(sid)
                channel["updated_at"] = _utcnow_iso()
                changed.append(self._serialize_channel(channel))
                actions.extend(self._sleep_actions_locked(channel))

            owned_channels = list(self.owner_channels.pop(sid, set()))
            for channel_id in owned_channels:
                channel = self.channels.get(channel_id)
                if not channel:
                    continue
                channel["owner_sid"] = None
                channel["state"] = STATE_OFFLINE
                channel["last_error"] = "owner_disconnected"
                channel["updated_at"] = _utcnow_iso()
                self._clear_pending_writes_locked(channel_id)
                self._close_history_handle_locked(channel)
                if channel["capture"]["active"]:
                    self._stop_capture_locked(channel, "owner_disconnected")
                changed.append(self._serialize_channel(channel))

            return changed, actions

    def mark_browser_channel_ready(
        self,
        owner_sid: str,
        channel_id: str,
        active: bool,
        error: Optional[str] = None,
    ) -> Optional[Dict]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel or channel["source_type"] != SOURCE_BROWSER_SERIAL:
                return None
            if channel.get("owner_sid") != owner_sid:
                return None

            channel["last_error"] = error
            channel["updated_at"] = _utcnow_iso()
            if active:
                channel["state"] = STATE_ACTIVE
            elif channel["owner_sid"]:
                channel["state"] = STATE_STANDBY
            else:
                channel["state"] = STATE_OFFLINE
            return self._serialize_channel(channel)

    def mark_server_channel_state(
        self,
        channel_id: str,
        active: bool,
        error: Optional[str] = None,
    ) -> Optional[Dict]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel or channel["source_type"] != SOURCE_SERVER_PYSERIAL:
                return None

            channel["last_error"] = error
            channel["updated_at"] = _utcnow_iso()
            channel["state"] = STATE_ACTIVE if active else STATE_STANDBY
            return self._serialize_channel(channel)

    def list_channels(self) -> List[Dict]:
        with self._lock:
            items = [self._serialize_channel(channel) for channel in self.channels.values()]

        def sort_key(item: Dict) -> Tuple[int, int, str]:
            capture_rank = 0 if item.get("capture_active") else 1
            state_rank = {
                STATE_ACTIVE: 0,
                STATE_ACTIVATING: 1,
                STATE_STANDBY: 2,
                STATE_OFFLINE: 3,
            }.get(item.get("state"), 9)
            return capture_rank, state_rank, item.get("display_name", "")

        items.sort(key=sort_key)
        return items

    def get_channel(self, channel_id: str) -> Optional[Dict]:
        with self._lock:
            channel = self.channels.get(channel_id)
            return self._serialize_channel(channel) if channel else None

    def close(self) -> None:
        with self._lock:
            for channel in self.channels.values():
                self._close_history_handle_locked(channel)

    def is_browser_owner(self, channel_id: str, sid: str) -> bool:
        with self._lock:
            channel = self.channels.get(channel_id)
            return bool(
                channel
                and channel["source_type"] == SOURCE_BROWSER_SERIAL
                and channel.get("owner_sid") == sid
            )

    def is_client_attached(self, channel_id: str, sid: str) -> bool:
        with self._lock:
            channel = self.channels.get(channel_id)
            return bool(channel and sid in channel["subscribers"])

    # ------------------------------------------------------------------ #
    # Capture lifecycle
    # ------------------------------------------------------------------ #
    def start_capture(
        self,
        channel_id: str,
        started_by: Optional[str] = None,
    ) -> Tuple[Optional[Dict], List[Dict], Optional[str]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None, [], "channel_not_found"
            if channel["source_type"] == SOURCE_BROWSER_SERIAL and channel["state"] == STATE_OFFLINE:
                return None, [], "channel_offline"

            capture = channel["capture"]
            if not capture["active"]:
                capture["active"] = True
                capture["started_at"] = _utcnow_iso()
                capture["started_by"] = started_by or ""
                capture["stopped_at"] = None
                capture["stop_reason"] = None
            channel["updated_at"] = _utcnow_iso()
            actions = self._activation_actions_locked(channel)
            return self._serialize_capture(channel), actions, None

    def stop_capture(
        self,
        channel_id: str,
        reason: str = "manual",
    ) -> Tuple[Optional[Dict], List[Dict], Optional[str]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None, [], "channel_not_found"
            if not channel["capture"]["active"]:
                return None, [], "capture_not_found"

            self._stop_capture_locked(channel, reason)
            actions = self._sleep_actions_locked(channel)
            return self._serialize_capture(channel), actions, None

    def get_capture_sessions(self) -> List[Dict]:
        with self._lock:
            sessions = [
                self._serialize_capture(channel)
                for channel in self.channels.values()
                if channel["capture"]["active"]
            ]
        sessions.sort(key=lambda item: item.get("started_at") or "", reverse=True)
        return sessions

    # ------------------------------------------------------------------ #
    # History and data flow
    # ------------------------------------------------------------------ #
    def append_rx_entry(self, channel_id: str, data: bytes) -> Optional[Dict]:
        return self._append_entry(channel_id, "rx", data, actor=None)

    def append_tx_entry(self, channel_id: str, data: bytes, actor: Optional[str]) -> Optional[Dict]:
        return self._append_entry(channel_id, "tx", data, actor=actor)

    def build_browser_write_request(
        self,
        channel_id: str,
        requester_sid: str,
        data: bytes,
        actor: Optional[str],
    ) -> Tuple[Optional[Dict], Optional[str]]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None, "channel_not_found"
            if channel["source_type"] != SOURCE_BROWSER_SERIAL:
                return None, "unsupported_channel_type"
            if channel["state"] != STATE_ACTIVE or not channel.get("owner_sid"):
                return None, "channel_not_active"

            request_id = f"write_{uuid.uuid4().hex}"
            self.pending_writes[request_id] = {
                "channel_id": channel_id,
                "requester_sid": requester_sid,
                "data": bytes(data),
                "actor": actor or "",
                "created_at": _utcnow_iso(),
            }
            return {
                "type": "browser_write_request",
                "channel_id": channel_id,
                "owner_sid": channel["owner_sid"],
                "request_id": request_id,
                "data": list(data),
            }, None

    def complete_browser_write(
        self,
        owner_sid: str,
        request_id: str,
        success: bool,
        error: Optional[str] = None,
    ) -> Tuple[Optional[Dict], Optional[Dict], Optional[str]]:
        with self._lock:
            request = self.pending_writes.pop(request_id, None)
            if not request:
                return None, None, "write_request_not_found"

            channel = self.channels.get(request["channel_id"])
            if not channel:
                return None, None, "channel_not_found"
            if channel.get("owner_sid") != owner_sid:
                return None, None, "owner_mismatch"

            ack = {
                "request_id": request_id,
                "channel_id": request["channel_id"],
                "requester_sid": request["requester_sid"],
                "bytes_written": len(request["data"]),
                "success": bool(success),
                "error": error or "",
            }
            if not success:
                return ack, None, None

        entry = self.append_tx_entry(
            request["channel_id"],
            request["data"],
            actor=request.get("actor") or None,
        )
        return ack, entry, None

    def fail_browser_writes_for_owner(self, owner_sid: str) -> List[Dict]:
        failed: List[Dict] = []
        with self._lock:
            for request_id, request in list(self.pending_writes.items()):
                channel = self.channels.get(request["channel_id"])
                if not channel or channel.get("owner_sid") != owner_sid:
                    continue
                self.pending_writes.pop(request_id, None)
                failed.append(
                    {
                        "request_id": request_id,
                        "channel_id": request["channel_id"],
                        "requester_sid": request["requester_sid"],
                        "bytes_written": 0,
                        "success": False,
                        "error": "owner_disconnected",
                    }
                )
        return failed

    def get_history(
        self,
        channel_id: str,
        before_seq: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Tuple[List[Dict], Optional[int], bool, Optional[str]]:
        page_size = max(1, min(int(limit or self.page_size), 1000))

        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return [], None, False, "channel_not_found"
            self._flush_history_handle_locked(channel)
            segments = list(channel["segments"])

        collected: List[Dict] = []
        found_older = False
        candidate_before = before_seq

        for segment in reversed(segments):
            if candidate_before is not None and segment["start_seq"] >= candidate_before:
                continue

            lines = self._read_segment_lines(segment["path"])
            for raw_line in reversed(lines):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                seq = int(entry.get("seq", 0))
                if candidate_before is not None and seq >= candidate_before:
                    continue
                if len(collected) >= page_size:
                    found_older = True
                    break
                collected.append(entry)
            if found_older:
                break

        collected.reverse()
        next_cursor = collected[0]["seq"] if collected else None
        return collected, next_cursor, found_older, None

    # ------------------------------------------------------------------ #
    # Helpers for channel state
    # ------------------------------------------------------------------ #
    def _activation_actions_locked(self, channel: Dict) -> List[Dict]:
        if channel["state"] in (STATE_ACTIVE, STATE_ACTIVATING, STATE_OFFLINE):
            return []

        needs_activation = bool(channel["subscribers"]) or channel["capture"]["active"]
        if not needs_activation:
            return []

        channel["state"] = STATE_ACTIVATING if channel["source_type"] == SOURCE_BROWSER_SERIAL else STATE_ACTIVE
        if channel["source_type"] == SOURCE_SERVER_PYSERIAL:
            return [
                {
                    "type": "server_open",
                    "channel_id": channel["channel_id"],
                    "device": channel["device"],
                    "config": dict(channel["config"]),
                }
            ]

        owner_sid = channel.get("owner_sid")
        if not owner_sid:
            channel["state"] = STATE_OFFLINE
            return []
        return [
            {
                "type": "browser_activate",
                "channel_id": channel["channel_id"],
                "owner_sid": owner_sid,
                "config": dict(channel["config"]),
            }
        ]

    def _sleep_actions_locked(self, channel: Dict) -> List[Dict]:
        if channel["capture"]["active"]:
            return []
        if channel["subscribers"]:
            return []
        if channel["state"] not in (STATE_ACTIVE, STATE_ACTIVATING):
            return []

        channel["state"] = STATE_STANDBY
        self._close_history_handle_locked(channel)

        if channel["source_type"] == SOURCE_SERVER_PYSERIAL:
            return [
                {
                    "type": "server_close",
                    "channel_id": channel["channel_id"],
                }
            ]

        owner_sid = channel.get("owner_sid")
        if not owner_sid:
            channel["state"] = STATE_OFFLINE
            return []
        return [
            {
                "type": "browser_sleep",
                "channel_id": channel["channel_id"],
                "owner_sid": owner_sid,
            }
        ]

    def _stop_capture_locked(self, channel: Dict, reason: str) -> None:
        capture = channel["capture"]
        capture["active"] = False
        capture["stopped_at"] = _utcnow_iso()
        capture["stop_reason"] = reason
        channel["updated_at"] = _utcnow_iso()

    def _append_entry(
        self,
        channel_id: str,
        direction: str,
        data: bytes,
        actor: Optional[str],
    ) -> Optional[Dict]:
        with self._lock:
            channel = self.channels.get(channel_id)
            if not channel:
                return None

            now = _utcnow_iso()
            seq = channel["next_seq"]
            channel["next_seq"] += 1
            channel["updated_at"] = now
            channel["last_activity_at"] = now
            if channel["source_type"] == SOURCE_BROWSER_SERIAL and channel["state"] == STATE_ACTIVATING:
                channel["state"] = STATE_ACTIVE

            entry = {
                "seq": seq,
                "ts": now,
                "dir": direction,
                "hex": data.hex(),
                "text": data.decode("utf-8", errors="replace"),
                "channel_id": channel_id,
            }
            if actor:
                entry["actor"] = actor

            channel["recent_entries"].append(entry)
            capture = channel["capture"]
            if capture["active"]:
                capture["bytes_logged"] += len(data)
                capture["last_entry_at"] = now

            self._write_history_entry_locked(channel, entry)
            return dict(entry)

    # ------------------------------------------------------------------ #
    # History storage
    # ------------------------------------------------------------------ #
    def _write_history_entry_locked(self, channel: Dict, entry: Dict) -> None:
        handle = self._ensure_history_handle_locked(channel)
        serialized = json.dumps(entry, ensure_ascii=False) + "\n"
        encoded = serialized.encode("utf-8")
        handle.write(serialized)
        handle.flush()
        channel["current_segment_entry_count"] += 1
        channel["current_segment_byte_count"] += len(encoded)

        segment = channel["segments"][-1]
        segment["count"] = channel["current_segment_entry_count"]
        segment["end_seq"] = entry["seq"]

    def _ensure_history_handle_locked(self, channel: Dict):
        rotate = channel["history_handle"] is None
        if not rotate:
            if channel["current_segment_entry_count"] >= self.segment_entry_limit:
                rotate = True
            elif channel["current_segment_byte_count"] >= self.segment_byte_limit:
                rotate = True

        if rotate:
            self._rotate_history_segment_locked(channel)
        return channel["history_handle"]

    def _rotate_history_segment_locked(self, channel: Dict) -> None:
        self._close_history_handle_locked(channel)
        channel["current_segment_index"] += 1
        channel["current_segment_entry_count"] = 0
        channel["current_segment_byte_count"] = 0

        history_dir = channel["history_dir"]
        os.makedirs(history_dir, exist_ok=True)
        filename = f"segment_{channel['current_segment_index']:06d}.jsonl"
        path = os.path.join(history_dir, filename)
        channel["history_handle"] = open(path, "a", encoding="utf-8")  # noqa: SIM115
        channel["segments"].append(
            {
                "index": channel["current_segment_index"],
                "path": path,
                "count": 0,
                "start_seq": channel["next_seq"],
                "end_seq": channel["next_seq"] - 1,
            }
        )

    def _flush_history_handle_locked(self, channel: Dict) -> None:
        handle = channel.get("history_handle")
        if handle:
            handle.flush()

    def _close_history_handle_locked(self, channel: Dict) -> None:
        handle = channel.get("history_handle")
        if not handle:
            return
        try:
            handle.flush()
            handle.close()
        except Exception:
            pass
        channel["history_handle"] = None

    def _read_segment_lines(self, path: str) -> List[str]:
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as handle:
            return handle.readlines()

    # ------------------------------------------------------------------ #
    # Serialization
    # ------------------------------------------------------------------ #
    def _serialize_channel(self, channel: Optional[Dict]) -> Optional[Dict]:
        if not channel:
            return None
        return {
            "channel_id": channel["channel_id"],
            "display_name": channel["display_name"],
            "device": channel["device"],
            "source_type": channel["source_type"],
            "state": channel["state"],
            "config": dict(channel["config"]),
            "subscriber_count": len(channel["subscribers"]),
            "capture_active": channel["capture"]["active"],
            "capture_started_at": channel["capture"]["started_at"],
            "capture_stop_reason": channel["capture"]["stop_reason"],
            "capture_last_entry_at": channel["capture"]["last_entry_at"],
            "capture_bytes_logged": channel["capture"]["bytes_logged"],
            "created_at": channel["created_at"],
            "updated_at": channel["updated_at"],
            "last_activity_at": channel["last_activity_at"],
            "owner_connected": bool(channel.get("owner_sid")) if channel["source_type"] == SOURCE_BROWSER_SERIAL else True,
            "is_browser_owned": channel["source_type"] == SOURCE_BROWSER_SERIAL,
            "can_background_capture": channel["source_type"] == SOURCE_SERVER_PYSERIAL,
            "browser_port": dict(channel["browser_port"]),
            "last_error": channel["last_error"],
            "latest_seq": channel["next_seq"] - 1,
        }

    def _serialize_capture(self, channel: Dict) -> Dict:
        capture = channel["capture"]
        return {
            "port_id": channel["channel_id"],
            "channel_id": channel["channel_id"],
            "display_name": channel["display_name"],
            "device": channel["device"],
            "source_type": channel["source_type"],
            "state": channel["state"],
            "config": dict(channel["config"]),
            "started_at": capture["started_at"],
            "started_by": capture["started_by"],
            "last_entry_at": capture["last_entry_at"],
            "bytes_logged": capture["bytes_logged"],
            "active": capture["active"],
            "stop_reason": capture["stop_reason"],
            "can_background_capture": channel["source_type"] == SOURCE_SERVER_PYSERIAL,
            "subscriber_count": len(channel["subscribers"]),
        }

    # ------------------------------------------------------------------ #
    # Channel construction
    # ------------------------------------------------------------------ #
    def _create_channel(
        self,
        channel_id: str,
        source_type: str,
        device: str,
        display_name: str,
        config: Dict,
        owner_sid: Optional[str],
        owner_label: Optional[str],
        browser_port: Optional[Dict],
    ) -> Dict:
        now = _utcnow_iso()
        history_dir = os.path.join(self.history_root, channel_id)
        return {
            "channel_id": channel_id,
            "source_type": source_type,
            "device": device,
            "display_name": display_name,
            "config": dict(config),
            "owner_sid": owner_sid,
            "owner_label": owner_label or "",
            "browser_port": browser_port or {},
            "state": STATE_STANDBY if owner_sid or source_type == SOURCE_SERVER_PYSERIAL else STATE_OFFLINE,
            "subscribers": set(),
            "recent_entries": deque(maxlen=self.recent_limit),
            "next_seq": 1,
            "created_at": now,
            "updated_at": now,
            "last_activity_at": None,
            "last_error": None,
            "history_dir": history_dir,
            "history_handle": None,
            "current_segment_index": 0,
            "current_segment_entry_count": 0,
            "current_segment_byte_count": 0,
            "segments": [],
            "capture": {
                "active": False,
                "started_at": None,
                "started_by": "",
                "stopped_at": None,
                "stop_reason": None,
                "last_entry_at": None,
                "bytes_logged": 0,
            },
        }

    def _normalize_config(self, config: Dict) -> Dict:
        parity = str(config.get("parity", "N") or "N").strip().upper()[:1] or "N"
        if parity not in {"N", "E", "O", "M", "S"}:
            parity = "N"
        try:
            baudrate = int(config.get("baudrate", 9600))
        except (TypeError, ValueError):
            baudrate = 9600
        try:
            bytesize = int(config.get("bytesize", 8))
        except (TypeError, ValueError):
            bytesize = 8
        try:
            stopbits = int(config.get("stopbits", 1))
        except (TypeError, ValueError):
            stopbits = 1
        return {
            "baudrate": baudrate,
            "bytesize": bytesize,
            "parity": parity,
            "stopbits": stopbits,
        }

    def _build_server_channel_id(self, device: str, config: Dict) -> str:
        parts = [
            "shared_srv",
            self._sanitize_component(device),
            str(config["baudrate"]),
            str(config["bytesize"]),
            config["parity"],
            str(config["stopbits"]),
        ]
        return "_".join(parts)

    def _default_browser_label(self, browser_port: Optional[Dict]) -> str:
        details = browser_port or {}
        vendor = details.get("usbVendorId")
        product = details.get("usbProductId")
        if vendor is None and product is None:
            return "WebSerial"
        return f"WebSerial_{vendor or 'NA'}_{product or 'NA'}"

    def _clear_pending_writes_locked(self, channel_id: str) -> None:
        for request_id, request in list(self.pending_writes.items()):
            if request.get("channel_id") == channel_id:
                self.pending_writes.pop(request_id, None)

    def _get_base_dir(self) -> str:
        if getattr(sys, "frozen", False):
            return os.path.dirname(sys.executable)
        return os.path.dirname(os.path.abspath(__file__))

    @staticmethod
    def _sanitize_component(text: str) -> str:
        sanitized = "".join(ch if ch.isalnum() else "_" for ch in str(text))
        while "__" in sanitized:
            sanitized = sanitized.replace("__", "_")
        return sanitized.strip("_") or "serial"


shared_serial_hub = SharedSerialHub()
