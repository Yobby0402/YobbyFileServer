from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime
from typing import Any, Dict, List

from .paths import get_data_path, project_path

_db_lock = threading.RLock()
_ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_GAMES_DEVICE_COOKIE = "games_device_id"
_GAMES_DEVICE_PATTERN = re.compile(r"[^a-zA-Z0-9_-]+")


def games_db_path() -> str:
    return get_data_path("games", "game_hub.sqlite3", create_parent=True)


def games_avatar_dir() -> str:
    path = get_data_path("games", "avatars", create_parent=True)
    os.makedirs(path, exist_ok=True)
    return path


def manifest_path() -> str:
    return project_path("static", "games", "manifest.json")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(games_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def current_week_key() -> str:
    now = datetime.now()
    iso_year, iso_week, _ = now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def normalize_nickname(value: Any) -> str:
    nickname = str(value or "").strip()
    if not nickname:
        return ""
    return nickname[:32]


def normalize_boss_path(value: Any) -> str:
    boss_path = str(value or "").strip().replace("\\", "/")
    boss_path = boss_path.lstrip("/")
    return boss_path[:240]


def normalize_boss_key(value: Any) -> str:
    key = str(value or "F9").strip().upper()
    allowed = {"F9", "TAB", "SPACE"}
    return key if key in allowed else "F9"


def normalize_game_id(value: Any) -> str:
    game_id = str(value or "").strip().lower()
    return game_id[:64]


def allowed_avatar_extension(filename: str) -> bool:
    _, ext = os.path.splitext(str(filename or ""))
    return ext.lower() in _ALLOWED_AVATAR_EXTENSIONS


def games_device_cookie_name() -> str:
    return _GAMES_DEVICE_COOKIE


def _sanitize_device_identity(value: Any) -> str:
    cleaned = _GAMES_DEVICE_PATTERN.sub("", str(value or "").strip())
    return cleaned[:64]


def create_device_identity() -> str:
    return f"dev-{secrets.token_hex(12)}"


def get_game_identity(request_obj: Any) -> str:
    header_value = _sanitize_device_identity(request_obj.headers.get("X-Games-Device-Id"))
    if header_value:
        return header_value
    cookie_value = _sanitize_device_identity(request_obj.cookies.get(_GAMES_DEVICE_COOKIE))
    if cookie_value:
        return cookie_value
    return create_device_identity()


def format_visitor_label(identity: Any) -> str:
    value = _sanitize_device_identity(identity) or "visitor"
    suffix = value[-6:].upper()
    return f"访客 {suffix}"


_MODERN_GAMES_DEVICE_PREFIX = "hw-"
_RANK_TIERS = [
    {"key": "blackiron", "name": "黑铁", "min_score": 0},
    {"key": "bronze", "name": "青铜", "min_score": 1500},
    {"key": "gold", "name": "黄金", "min_score": 6000},
    {"key": "platinum", "name": "铂金", "min_score": 16000},
    {"key": "diamond", "name": "钻石", "min_score": 36000},
    {"key": "star", "name": "星耀", "min_score": 72000},
    {"key": "tomorrowstar", "name": "明日之星", "min_score": 150000},
]


def _standard_rank_tiers() -> List[Dict[str, Any]]:
    return _RANK_TIERS[:-1]


def modern_games_device_prefix() -> str:
    return _MODERN_GAMES_DEVICE_PREFIX


def format_visitor_label(identity: Any) -> str:  # type: ignore[no-redef]
    value = _sanitize_device_identity(identity) or "visitor"
    suffix = value[-6:].upper()
    return f"访客 {suffix}"


def is_modern_games_device_identity(identity: Any) -> bool:
    value = _sanitize_device_identity(identity)
    return bool(value) and value.startswith(_MODERN_GAMES_DEVICE_PREFIX)


def rank_info_for_score(total_score: Any) -> Dict[str, Any]:
    score = max(0, int(total_score or 0))
    tiers = _standard_rank_tiers()
    current = tiers[0]
    next_rank = None
    for index, tier in enumerate(tiers):
        if score >= int(tier["min_score"]):
            current = tier
            next_rank = tiers[index + 1] if index + 1 < len(tiers) else None
        else:
            next_rank = tier
            break
    return {
        "key": current["key"],
        "name": current["name"],
        "min_score": int(current["min_score"]),
        "next_name": next_rank["name"] if next_rank else "",
        "next_score": int(next_rank["min_score"]) if next_rank else int(current["min_score"]),
        "progress_score": score,
    }


def rank_info_for_identity(identity: Any, total_score: Any, top_identity: Any = "") -> Dict[str, Any]:
    score = max(0, int(total_score or 0))
    top_value = _sanitize_device_identity(top_identity)
    current_value = _sanitize_device_identity(identity)
    if score > 0 and top_value and current_value == top_value:
        top_rank = dict(_RANK_TIERS[-1])
        return {
            "key": top_rank["key"],
            "name": top_rank["name"],
            "min_score": int(top_rank["min_score"]),
            "next_name": "",
            "next_score": int(top_rank["min_score"]),
            "progress_score": score,
            "is_global_top": True,
        }
    rank = rank_info_for_score(score)
    rank["is_global_top"] = False
    return rank


def load_games_manifest() -> Dict[str, Any]:
    try:
        with open(manifest_path(), "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        payload = {"title": "Yobboy Games", "games": []}
    payload.setdefault("title", "Yobboy Games")
    payload.setdefault("games", [])
    return payload


class GameHubStore:
    def __init__(self) -> None:
        self.ensure_schema()

    def ensure_schema(self) -> None:
        with _db_lock:
            conn = _connect()
            try:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS ip_profiles (
                        ip TEXT PRIMARY KEY,
                        nickname TEXT NOT NULL DEFAULT '',
                        avatar_filename TEXT NOT NULL DEFAULT '',
                        boss_path TEXT NOT NULL DEFAULT '',
                        boss_key TEXT NOT NULL DEFAULT 'F9',
                        created_at TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS game_states (
                        ip TEXT NOT NULL,
                        game_id TEXT NOT NULL,
                        state_json TEXT NOT NULL DEFAULT '{}',
                        summary_json TEXT NOT NULL DEFAULT '{}',
                        updated_at TEXT NOT NULL DEFAULT '',
                        PRIMARY KEY (ip, game_id)
                    );

                    CREATE TABLE IF NOT EXISTS game_scores (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ip TEXT NOT NULL,
                        game_id TEXT NOT NULL,
                        score INTEGER NOT NULL DEFAULT 0,
                        mode TEXT NOT NULL DEFAULT '',
                        session_key TEXT NOT NULL DEFAULT '',
                        meta_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL DEFAULT '',
                        week_key TEXT NOT NULL DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS game_score_claims (
                        ip TEXT NOT NULL,
                        game_id TEXT NOT NULL,
                        unique_key TEXT NOT NULL,
                        score_id INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL DEFAULT '',
                        PRIMARY KEY (ip, game_id, unique_key)
                    );

                    CREATE TABLE IF NOT EXISTS online_presence (
                        ip TEXT PRIMARY KEY,
                        current_game TEXT NOT NULL DEFAULT '',
                        play_status TEXT NOT NULL DEFAULT '',
                        room_code TEXT NOT NULL DEFAULT '',
                        last_seen TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS game_rooms (
                        room_type TEXT NOT NULL,
                        room_code TEXT NOT NULL,
                        state_json TEXT NOT NULL DEFAULT '{}',
                        updated_at TEXT NOT NULL DEFAULT '',
                        PRIMARY KEY (room_type, room_code)
                    );

                    CREATE TABLE IF NOT EXISTS game_room_records (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        room_type TEXT NOT NULL,
                        room_code TEXT NOT NULL,
                        record_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL DEFAULT ''
                    );

                    CREATE INDEX IF NOT EXISTS idx_game_scores_week_key ON game_scores(week_key);
                    CREATE INDEX IF NOT EXISTS idx_game_scores_game_week ON game_scores(game_id, week_key, score DESC);
                    CREATE INDEX IF NOT EXISTS idx_game_scores_ip_created ON game_scores(ip, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_online_presence_last_seen ON online_presence(last_seen);
                    CREATE INDEX IF NOT EXISTS idx_game_rooms_type_updated ON game_rooms(room_type, updated_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_game_room_records_type_created ON game_room_records(room_type, created_at DESC, id DESC);
                    """
                )
                self._ensure_column(conn, "ip_profiles", "boss_path", "TEXT NOT NULL DEFAULT ''")
                self._ensure_column(conn, "ip_profiles", "boss_key", "TEXT NOT NULL DEFAULT 'F9'")
                conn.commit()
            finally:
                conn.close()

    def _ensure_column(self, conn: sqlite3.Connection, table_name: str, column_name: str, sql_type: str) -> None:
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
        if column_name not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sql_type}")

    def _decode_json(self, value: str, fallback: Any) -> Any:
        try:
            return json.loads(value or "")
        except Exception:
            return fallback

    def _profile_row_to_dict(self, row: sqlite3.Row | None, ip: str) -> Dict[str, Any]:
        if row is None:
            return {
                "ip": ip,
                "identity": ip,
                "nickname": "",
                "avatar_filename": "",
                "boss_path": "",
                "boss_key": "F9",
                "created_at": "",
                "updated_at": "",
            }
        data = {key: row[key] for key in row.keys()}
        data.setdefault("boss_path", "")
        data["boss_key"] = normalize_boss_key(data.get("boss_key"))
        data.setdefault("identity", data.get("ip", ip))
        return data

    def _score_row_to_dict(self, row: sqlite3.Row | None, fallback_ip: str = "", fallback_game_id: str = "") -> Dict[str, Any]:
        if row is None:
            return {
                "id": 0,
                "ip": fallback_ip,
                "game_id": fallback_game_id,
                "score": 0,
                "mode": "",
                "session_key": "",
                "meta": {},
                "created_at": "",
                "week_key": current_week_key(),
            }
        return {
            "id": int(row["id"] or 0),
            "ip": row["ip"] or fallback_ip,
            "game_id": row["game_id"] or fallback_game_id,
            "score": int(row["score"] or 0),
            "mode": row["mode"] or "",
            "session_key": row["session_key"] or "",
            "meta": self._decode_json(row["meta_json"], {}),
            "created_at": row["created_at"] or "",
            "week_key": row["week_key"] or current_week_key(),
        }

    def get_profile(self, ip: str) -> Dict[str, Any]:
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                row = conn.execute(
                    """
                    SELECT ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at
                    FROM ip_profiles
                    WHERE ip = ?
                    """,
                    (ip,),
                ).fetchone()
            finally:
                conn.close()
        return self._profile_row_to_dict(row, ip)

    def list_player_profiles(self, limit: int = 500) -> List[Dict[str, Any]]:
        self.ensure_schema()
        safe_limit = max(1, min(int(limit or 500), 2000))
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    """
                    WITH identities AS (
                        SELECT ip FROM ip_profiles
                        UNION
                        SELECT ip FROM game_scores
                        UNION
                        SELECT ip FROM game_states
                        UNION
                        SELECT ip FROM online_presence
                    ),
                    score_stats AS (
                        SELECT ip,
                               COALESCE(SUM(score), 0) AS total_score,
                               COUNT(*) AS play_count,
                               MAX(created_at) AS last_score_at
                        FROM game_scores
                        GROUP BY ip
                    ),
                    state_stats AS (
                        SELECT ip,
                               COUNT(*) AS state_count,
                               MAX(updated_at) AS last_state_at
                        FROM game_states
                        GROUP BY ip
                    )
                    SELECT i.ip,
                           COALESCE(p.nickname, '') AS nickname,
                           COALESCE(p.avatar_filename, '') AS avatar_filename,
                           COALESCE(p.updated_at, '') AS profile_updated_at,
                           COALESCE(p.created_at, '') AS created_at,
                           COALESCE(s.total_score, 0) AS total_score,
                           COALESCE(s.play_count, 0) AS play_count,
                           COALESCE(gs.state_count, 0) AS state_count,
                           COALESCE(s.last_score_at, '') AS last_score_at,
                           COALESCE(gs.last_state_at, '') AS last_state_at
                    FROM identities i
                    LEFT JOIN ip_profiles p ON p.ip = i.ip
                    LEFT JOIN score_stats s ON s.ip = i.ip
                    LEFT JOIN state_stats gs ON gs.ip = i.ip
                    ORDER BY total_score DESC, play_count DESC, profile_updated_at DESC, i.ip ASC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
            finally:
                conn.close()
        result: List[Dict[str, Any]] = []
        for row in rows:
            identity = str(row["ip"] or "")
            nickname = normalize_nickname(row["nickname"] or "")
            result.append(
                {
                    "ip": identity,
                    "identity": identity,
                    "nickname": nickname,
                    "display_name": nickname or format_visitor_label(identity),
                    "avatar_filename": row["avatar_filename"] or "",
                    "total_score": int(row["total_score"] or 0),
                    "play_count": int(row["play_count"] or 0),
                    "state_count": int(row["state_count"] or 0),
                    "created_at": row["created_at"] or "",
                    "profile_updated_at": row["profile_updated_at"] or "",
                    "last_score_at": row["last_score_at"] or "",
                    "last_state_at": row["last_state_at"] or "",
                }
            )
        return result

    def grant_topdown_meta_pulls_to_all_users(
        self,
        color_pulls: int = 0,
        icon_pulls: int = 0,
        background_pulls: int = 0,
    ) -> Dict[str, Any]:
        def _safe_pull_count(value: Any) -> int:
            try:
                return max(0, int(float(value)))
            except (TypeError, ValueError):
                return 0

        grant_color = _safe_pull_count(color_pulls)
        grant_icon = _safe_pull_count(icon_pulls)
        grant_background = _safe_pull_count(background_pulls)
        if grant_color <= 0 and grant_icon <= 0 and grant_background <= 0:
            return {
                "identity_count": 0,
                "updated_count": 0,
                "created_state_count": 0,
                "color_pulls": grant_color,
                "icon_pulls": grant_icon,
                "background_pulls": grant_background,
            }

        game_id = normalize_game_id("topdown-shooter-meta")
        updated_at = now_iso()
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                identities = conn.execute(
                    """
                    WITH identities AS (
                        SELECT ip FROM ip_profiles
                        UNION
                        SELECT ip FROM game_scores
                        UNION
                        SELECT ip FROM game_states
                        UNION
                        SELECT ip FROM online_presence
                    )
                    SELECT ip
                    FROM identities
                    WHERE COALESCE(TRIM(ip), '') <> ''
                    ORDER BY ip ASC
                    """
                ).fetchall()

                updated_count = 0
                created_state_count = 0
                for row in identities:
                    identity = _sanitize_device_identity(str(row["ip"] or ""))
                    if not identity:
                        continue
                    current = conn.execute(
                        """
                        SELECT state_json, summary_json
                        FROM game_states
                        WHERE ip = ? AND game_id = ?
                        """,
                        (identity, game_id),
                    ).fetchone()
                    state = self._decode_json(current["state_json"], {}) if current else {}
                    summary = self._decode_json(current["summary_json"], {}) if current else {}
                    if not isinstance(state, dict):
                        state = {}
                    if not isinstance(summary, dict):
                        summary = {}

                    state["freeColorPulls"] = _safe_pull_count(state.get("freeColorPulls")) + grant_color
                    state["freeIconPulls"] = _safe_pull_count(state.get("freeIconPulls")) + grant_icon
                    state["freeBackgroundPulls"] = _safe_pull_count(state.get("freeBackgroundPulls")) + grant_background

                    summary["free_color_pulls"] = state["freeColorPulls"]
                    summary["free_icon_pulls"] = state["freeIconPulls"]
                    summary["free_background_pulls"] = state["freeBackgroundPulls"]

                    conn.execute(
                        """
                        INSERT INTO game_states (ip, game_id, state_json, summary_json, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(ip, game_id) DO UPDATE SET
                            state_json = excluded.state_json,
                            summary_json = excluded.summary_json,
                            updated_at = excluded.updated_at
                        """,
                        (
                            identity,
                            game_id,
                            json.dumps(state, ensure_ascii=False),
                            json.dumps(summary, ensure_ascii=False),
                            updated_at,
                        ),
                    )
                    updated_count += 1
                    if current is None:
                        created_state_count += 1
                conn.commit()
            finally:
                conn.close()

        return {
            "identity_count": len(identities),
            "updated_count": updated_count,
            "created_state_count": created_state_count,
            "color_pulls": grant_color,
            "icon_pulls": grant_icon,
            "background_pulls": grant_background,
        }

    def grant_score_compensation(
        self,
        ip: str,
        score: Any,
        note: Any = "",
        operator: Any = "",
    ) -> Dict[str, Any]:
        identity = _sanitize_device_identity(ip)
        if not identity:
            raise ValueError("玩家标识不能为空")
        try:
            score_value = int(score or 0)
        except (TypeError, ValueError):
            raise ValueError("补偿积分必须是整数")
        if score_value <= 0:
            raise ValueError("补偿积分必须大于 0")

        note_value = str(note or "").strip()[:200]
        operator_value = str(operator or "").strip()[:64]
        return self.record_score(
            identity,
            "admin-compensation",
            score_value,
            mode="manual-compensation",
            meta={
                "note": note_value,
                "operator": operator_value,
                "source": "desktop-admin",
            },
        )

    def delete_player_data(self, ip: str) -> Dict[str, Any]:
        identity = _sanitize_device_identity(ip)
        if not identity:
            return {
                "identity": "",
                "deleted_profile": 0,
                "deleted_scores": 0,
                "deleted_states": 0,
                "deleted_presence": 0,
                "avatar_deleted": False,
            }
        self.ensure_schema()
        avatar_filename = ""
        with _db_lock:
            conn = _connect()
            try:
                profile_row = conn.execute(
                    "SELECT avatar_filename FROM ip_profiles WHERE ip = ?",
                    (identity,),
                ).fetchone()
                avatar_filename = str((profile_row["avatar_filename"] if profile_row else "") or "")
                deleted_scores = conn.execute("DELETE FROM game_scores WHERE ip = ?", (identity,)).rowcount
                deleted_states = conn.execute("DELETE FROM game_states WHERE ip = ?", (identity,)).rowcount
                deleted_presence = conn.execute("DELETE FROM online_presence WHERE ip = ?", (identity,)).rowcount
                deleted_profile = conn.execute("DELETE FROM ip_profiles WHERE ip = ?", (identity,)).rowcount
                conn.commit()
            finally:
                conn.close()
        avatar_deleted = False
        if avatar_filename:
            avatar_path = os.path.join(games_avatar_dir(), avatar_filename)
            if os.path.isfile(avatar_path):
                try:
                    os.remove(avatar_path)
                    avatar_deleted = True
                except OSError:
                    avatar_deleted = False
        return {
            "identity": identity,
            "deleted_profile": int(deleted_profile or 0),
            "deleted_scores": int(deleted_scores or 0),
            "deleted_states": int(deleted_states or 0),
            "deleted_presence": int(deleted_presence or 0),
            "avatar_deleted": avatar_deleted,
        }

    def total_score_summary(self, ip: str) -> Dict[str, int]:
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                row = conn.execute(
                    """
                    SELECT COALESCE(SUM(score), 0) AS total_score,
                           COUNT(*) AS play_count
                    FROM game_scores
                    WHERE ip = ?
                    """,
                    (ip,),
                ).fetchone()
            finally:
                conn.close()
        return {
            "total_score": int((row["total_score"] if row else 0) or 0),
            "play_count": int((row["play_count"] if row else 0) or 0),
        }

    def total_score_summaries(self, ips: List[str]) -> Dict[str, Dict[str, int]]:
        identity_list = []
        for item in ips or []:
            key = str(item or "").strip()
            if key and key not in identity_list:
                identity_list.append(key)
        if not identity_list:
            return {}
        placeholders = ",".join(["?"] * len(identity_list))
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    f"""
                    SELECT ip,
                           COALESCE(SUM(score), 0) AS total_score,
                           COUNT(*) AS play_count
                    FROM game_scores
                    WHERE ip IN ({placeholders})
                    GROUP BY ip
                    """,
                    tuple(identity_list),
                ).fetchall()
            finally:
                conn.close()
        result = {
            identity: {
                "total_score": 0,
                "play_count": 0,
            }
            for identity in identity_list
        }
        for row in rows:
            identity = str(row["ip"] or "").strip()
            if not identity:
                continue
            result[identity] = {
                "total_score": int((row["total_score"] if row else 0) or 0),
                "play_count": int((row["play_count"] if row else 0) or 0),
            }
        return result

    def migrate_identity(self, legacy_ip: str, stable_ip: str) -> bool:
        legacy_value = _sanitize_device_identity(legacy_ip)
        stable_value = _sanitize_device_identity(stable_ip)
        if not legacy_value or not stable_value or legacy_value == stable_value:
            return False
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                legacy_profile = conn.execute(
                    "SELECT ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at FROM ip_profiles WHERE ip = ?",
                    (legacy_value,),
                ).fetchone()
                legacy_score_count = conn.execute("SELECT COUNT(*) AS count FROM game_scores WHERE ip = ?", (legacy_value,)).fetchone()
                legacy_state_count = conn.execute("SELECT COUNT(*) AS count FROM game_states WHERE ip = ?", (legacy_value,)).fetchone()
                legacy_presence = conn.execute(
                    "SELECT current_game, play_status, room_code, last_seen, updated_at FROM online_presence WHERE ip = ?",
                    (legacy_value,),
                ).fetchone()
                if legacy_profile is None and int((legacy_score_count["count"] if legacy_score_count else 0) or 0) <= 0 and int((legacy_state_count["count"] if legacy_state_count else 0) or 0) <= 0 and legacy_presence is None:
                    return False
                stable_profile = conn.execute(
                    "SELECT ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at FROM ip_profiles WHERE ip = ?",
                    (stable_value,),
                ).fetchone()

                merged_nickname = normalize_nickname((stable_profile["nickname"] if stable_profile and stable_profile["nickname"] else (legacy_profile["nickname"] if legacy_profile else "")))
                merged_avatar = (stable_profile["avatar_filename"] if stable_profile and stable_profile["avatar_filename"] else (legacy_profile["avatar_filename"] if legacy_profile else "")) or ""
                merged_boss_path = normalize_boss_path((stable_profile["boss_path"] if stable_profile and stable_profile["boss_path"] else (legacy_profile["boss_path"] if legacy_profile else "")))
                merged_boss_key = normalize_boss_key((stable_profile["boss_key"] if stable_profile and stable_profile["boss_key"] else (legacy_profile["boss_key"] if legacy_profile else "F9")))
                created_candidates = [value for value in [stable_profile["created_at"] if stable_profile else "", legacy_profile["created_at"] if legacy_profile else ""] if value]
                updated_candidates = [value for value in [stable_profile["updated_at"] if stable_profile else "", legacy_profile["updated_at"] if legacy_profile else ""] if value]
                merged_created_at = min(created_candidates) if created_candidates else now_iso()
                merged_updated_at = max(updated_candidates) if updated_candidates else now_iso()

                conn.execute(
                    """
                    INSERT INTO ip_profiles (ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ip) DO UPDATE SET
                        nickname = excluded.nickname,
                        avatar_filename = excluded.avatar_filename,
                        boss_path = excluded.boss_path,
                        boss_key = excluded.boss_key,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at
                    """,
                    (stable_value, merged_nickname, merged_avatar, merged_boss_path, merged_boss_key, merged_created_at, merged_updated_at),
                )

                conn.execute("UPDATE game_scores SET ip = ? WHERE ip = ?", (stable_value, legacy_value))

                legacy_states = conn.execute(
                    "SELECT game_id, state_json, summary_json, updated_at FROM game_states WHERE ip = ?",
                    (legacy_value,),
                ).fetchall()
                for row in legacy_states:
                    stable_state = conn.execute(
                        "SELECT updated_at FROM game_states WHERE ip = ? AND game_id = ?",
                        (stable_value, row["game_id"]),
                    ).fetchone()
                    if stable_state is None or (row["updated_at"] or "") >= (stable_state["updated_at"] or ""):
                        conn.execute(
                            """
                            INSERT INTO game_states (ip, game_id, state_json, summary_json, updated_at)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(ip, game_id) DO UPDATE SET
                                state_json = excluded.state_json,
                                summary_json = excluded.summary_json,
                                updated_at = excluded.updated_at
                            """,
                            (stable_value, row["game_id"], row["state_json"], row["summary_json"], row["updated_at"] or now_iso()),
                        )
                stable_presence = conn.execute(
                    "SELECT current_game, play_status, room_code, last_seen, updated_at FROM online_presence WHERE ip = ?",
                    (stable_value,),
                ).fetchone()
                chosen_presence = legacy_presence
                if stable_presence and (stable_presence["last_seen"] or "") >= ((legacy_presence["last_seen"] if legacy_presence else "") or ""):
                    chosen_presence = stable_presence
                if chosen_presence is not None:
                    conn.execute(
                        """
                        INSERT INTO online_presence (ip, current_game, play_status, room_code, last_seen, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(ip) DO UPDATE SET
                            current_game = excluded.current_game,
                            play_status = excluded.play_status,
                            room_code = excluded.room_code,
                            last_seen = excluded.last_seen,
                            updated_at = excluded.updated_at
                        """,
                        (
                            stable_value,
                            chosen_presence["current_game"] or "",
                            chosen_presence["play_status"] or "",
                            chosen_presence["room_code"] or "",
                            chosen_presence["last_seen"] or now_iso(),
                            chosen_presence["updated_at"] or now_iso(),
                        ),
                    )

                conn.execute("DELETE FROM game_states WHERE ip = ?", (legacy_value,))
                conn.execute("DELETE FROM online_presence WHERE ip = ?", (legacy_value,))
                conn.execute("DELETE FROM ip_profiles WHERE ip = ?", (legacy_value,))
                conn.commit()
            finally:
                conn.close()
        return True

    def top_total_score_identity(self) -> str:
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                row = conn.execute(
                    """
                    SELECT ip, COALESCE(SUM(score), 0) AS total_score
                    FROM game_scores
                    GROUP BY ip
                    ORDER BY total_score DESC, ip ASC
                    LIMIT 1
                    """
                ).fetchone()
            finally:
                conn.close()
        return str(row["ip"] or "") if row else ""

    def upsert_profile(self, ip: str, nickname: str, boss_path: str | None = None, boss_key: str | None = None) -> Dict[str, Any]:
        nickname = normalize_nickname(nickname)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                current = conn.execute(
                    "SELECT avatar_filename, boss_path, boss_key, created_at FROM ip_profiles WHERE ip = ?",
                    (ip,),
                ).fetchone()
                created_at = current["created_at"] if current and current["created_at"] else now_iso()
                avatar_filename = current["avatar_filename"] if current else ""
                next_boss_path = normalize_boss_path(boss_path) if boss_path is not None else (current["boss_path"] if current else "")
                next_boss_key = normalize_boss_key(boss_key) if boss_key is not None else (normalize_boss_key(current["boss_key"]) if current else "F9")
                conn.execute(
                    """
                    INSERT INTO ip_profiles (ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ip) DO UPDATE SET
                        nickname = excluded.nickname,
                        boss_path = excluded.boss_path,
                        boss_key = excluded.boss_key,
                        updated_at = excluded.updated_at
                    """,
                    (ip, nickname, avatar_filename, next_boss_path, next_boss_key, created_at, now_iso()),
                )
                conn.commit()
            finally:
                conn.close()
        return self.get_profile(ip)

    def set_avatar(self, ip: str, avatar_filename: str) -> Dict[str, Any]:
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                current = conn.execute(
                    "SELECT nickname, boss_path, boss_key, created_at, avatar_filename FROM ip_profiles WHERE ip = ?",
                    (ip,),
                ).fetchone()
                nickname = current["nickname"] if current else ""
                boss_path = current["boss_path"] if current else ""
                boss_key = normalize_boss_key(current["boss_key"]) if current else "F9"
                created_at = current["created_at"] if current and current["created_at"] else now_iso()
                old_avatar = current["avatar_filename"] if current else ""
                conn.execute(
                    """
                    INSERT INTO ip_profiles (ip, nickname, avatar_filename, boss_path, boss_key, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ip) DO UPDATE SET
                        avatar_filename = excluded.avatar_filename,
                        updated_at = excluded.updated_at
                    """,
                    (ip, nickname, avatar_filename, boss_path, boss_key, created_at, now_iso()),
                )
                conn.commit()
            finally:
                conn.close()

        if old_avatar and old_avatar != avatar_filename:
            old_path = os.path.join(games_avatar_dir(), old_avatar)
            if os.path.isfile(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass
        return self.get_profile(ip)

    def get_game_state(self, ip: str, game_id: str) -> Dict[str, Any]:
        game_id = normalize_game_id(game_id)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                row = conn.execute(
                    """
                    SELECT game_id, state_json, summary_json, updated_at
                    FROM game_states
                    WHERE ip = ? AND game_id = ?
                    """,
                    (ip, game_id),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return {
                "game_id": game_id,
                "state": {},
                "summary": {},
                "updated_at": "",
            }
        return {
            "game_id": row["game_id"],
            "state": self._decode_json(row["state_json"], {}),
            "summary": self._decode_json(row["summary_json"], {}),
            "updated_at": row["updated_at"] or "",
        }

    def save_game_state(self, ip: str, game_id: str, state: Any, summary: Any) -> Dict[str, Any]:
        game_id = normalize_game_id(game_id)
        updated_at = now_iso()
        state_json = json.dumps(state or {}, ensure_ascii=False)
        summary_json = json.dumps(summary or {}, ensure_ascii=False)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                conn.execute(
                    """
                    INSERT INTO game_states (ip, game_id, state_json, summary_json, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(ip, game_id) DO UPDATE SET
                        state_json = excluded.state_json,
                        summary_json = excluded.summary_json,
                        updated_at = excluded.updated_at
                    """,
                    (ip, game_id, state_json, summary_json, updated_at),
                )
                conn.commit()
            finally:
                conn.close()
        return self.get_game_state(ip, game_id)

    def clear_game_state(self, ip: str, game_id: str) -> None:
        game_id = normalize_game_id(game_id)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                conn.execute("DELETE FROM game_states WHERE ip = ? AND game_id = ?", (ip, game_id))
                conn.commit()
            finally:
                conn.close()

    def get_room_state(self, room_type: str, room_code: str) -> Dict[str, Any]:
        room_type_value = normalize_game_id(room_type)
        room_code_value = str(room_code or "").strip().upper()[:32]
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                row = conn.execute(
                    """
                    SELECT room_type, room_code, state_json, updated_at
                    FROM game_rooms
                    WHERE room_type = ? AND room_code = ?
                    """,
                    (room_type_value, room_code_value),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return {
                "room_type": room_type_value,
                "room_code": room_code_value,
                "state": {},
                "updated_at": "",
            }
        return {
            "room_type": row["room_type"],
            "room_code": row["room_code"],
            "state": self._decode_json(row["state_json"], {}),
            "updated_at": row["updated_at"] or "",
        }

    def save_room_state(self, room_type: str, room_code: str, state: Any) -> Dict[str, Any]:
        room_type_value = normalize_game_id(room_type)
        room_code_value = str(room_code or "").strip().upper()[:32]
        updated_at = now_iso()
        state_json = json.dumps(state or {}, ensure_ascii=False)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                conn.execute(
                    """
                    INSERT INTO game_rooms (room_type, room_code, state_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(room_type, room_code) DO UPDATE SET
                        state_json = excluded.state_json,
                        updated_at = excluded.updated_at
                    """,
                    (room_type_value, room_code_value, state_json, updated_at),
                )
                conn.commit()
            finally:
                conn.close()
        return {
            "room_type": room_type_value,
            "room_code": room_code_value,
            "state": state or {},
            "updated_at": updated_at,
        }

    def delete_room_state(self, room_type: str, room_code: str) -> None:
        room_type_value = normalize_game_id(room_type)
        room_code_value = str(room_code or "").strip().upper()[:32]
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                conn.execute(
                    "DELETE FROM game_rooms WHERE room_type = ? AND room_code = ?",
                    (room_type_value, room_code_value),
                )
                conn.commit()
            finally:
                conn.close()

    def list_room_states(self, room_type: str) -> List[Dict[str, Any]]:
        room_type_value = normalize_game_id(room_type)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    """
                    SELECT room_type, room_code, state_json, updated_at
                    FROM game_rooms
                    WHERE room_type = ?
                    ORDER BY updated_at DESC, room_code ASC
                    """,
                    (room_type_value,),
                ).fetchall()
            finally:
                conn.close()
        return [
            {
                "room_type": row["room_type"],
                "room_code": row["room_code"],
                "state": self._decode_json(row["state_json"], {}),
                "updated_at": row["updated_at"] or "",
            }
            for row in rows
        ]

    def record_room_record(self, room_type: str, room_code: str, record: Any) -> Dict[str, Any]:
        room_type_value = normalize_game_id(room_type)
        room_code_value = str(room_code or "").strip().upper()[:32]
        payload = record if isinstance(record, dict) else {}
        created_at = str(payload.get("finished_at") or payload.get("created_at") or now_iso())
        record_json = json.dumps(payload, ensure_ascii=False)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO game_room_records (room_type, room_code, record_json, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (room_type_value, room_code_value, record_json, created_at),
                )
                conn.commit()
                record_id = int(cursor.lastrowid or 0)
            finally:
                conn.close()
        return {
            "record_id": record_id,
            "room_type": room_type_value,
            "room_code": room_code_value,
            "record": payload,
            "created_at": created_at,
        }

    def list_room_records(self, room_type: str, limit: int = 100) -> List[Dict[str, Any]]:
        room_type_value = normalize_game_id(room_type)
        limit_value = max(1, min(500, int(limit or 100)))
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id, room_type, room_code, record_json, created_at
                    FROM game_room_records
                    WHERE room_type = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT ?
                    """,
                    (room_type_value, limit_value),
                ).fetchall()
            finally:
                conn.close()
        return [
            {
                "record_id": int(row["id"] or 0),
                "room_type": row["room_type"],
                "room_code": row["room_code"],
                "record": self._decode_json(row["record_json"], {}),
                "created_at": row["created_at"] or "",
            }
            for row in rows
        ]

    def record_score(
        self,
        ip: str,
        game_id: str,
        score: Any,
        mode: Any = "",
        session_key: Any = "",
        meta: Any = None,
        unique_key: Any = "",
    ) -> Dict[str, Any]:
        game_id = normalize_game_id(game_id)
        mode_value = str(mode or "").strip()[:64]
        session_key_value = str(session_key or "").strip()[:96]
        unique_key_value = str(unique_key or "").strip()[:160]
        try:
            score_value = int(score or 0)
        except Exception:
            score_value = 0
        created_at = now_iso()
        meta_json = json.dumps(meta or {}, ensure_ascii=False)
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                if unique_key_value:
                    existing_claim = conn.execute(
                        """
                        SELECT score_id
                        FROM game_score_claims
                        WHERE ip = ? AND game_id = ? AND unique_key = ?
                        """,
                        (ip, game_id, unique_key_value),
                    ).fetchone()
                    if existing_claim is not None:
                        existing_row = conn.execute(
                            """
                            SELECT id, ip, game_id, score, mode, session_key, meta_json, created_at, week_key
                            FROM game_scores
                            WHERE id = ?
                            """,
                            (int(existing_claim["score_id"] or 0),),
                        ).fetchone()
                        payload = self._score_row_to_dict(existing_row, ip, game_id)
                        payload["duplicate"] = True
                        payload["unique_key"] = unique_key_value
                        return payload

                cursor = conn.execute(
                    """
                    INSERT INTO game_scores (ip, game_id, score, mode, session_key, meta_json, created_at, week_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (ip, game_id, score_value, mode_value, session_key_value, meta_json, created_at, current_week_key()),
                )
                score_id = int(cursor.lastrowid)
                if unique_key_value:
                    try:
                        conn.execute(
                            """
                            INSERT INTO game_score_claims (ip, game_id, unique_key, score_id, created_at)
                            VALUES (?, ?, ?, ?, ?)
                            """,
                            (ip, game_id, unique_key_value, score_id, created_at),
                        )
                    except sqlite3.IntegrityError:
                        conn.rollback()
                        existing_claim = conn.execute(
                            """
                            SELECT score_id
                            FROM game_score_claims
                            WHERE ip = ? AND game_id = ? AND unique_key = ?
                            """,
                            (ip, game_id, unique_key_value),
                        ).fetchone()
                        existing_row = conn.execute(
                            """
                            SELECT id, ip, game_id, score, mode, session_key, meta_json, created_at, week_key
                            FROM game_scores
                            WHERE id = ?
                            """,
                            (int(existing_claim["score_id"] or 0) if existing_claim else 0,),
                        ).fetchone()
                        payload = self._score_row_to_dict(existing_row, ip, game_id)
                        payload["duplicate"] = True
                        payload["unique_key"] = unique_key_value
                        return payload
                conn.commit()
            finally:
                conn.close()
        return {
            "id": score_id,
            "ip": ip,
            "game_id": game_id,
            "score": score_value,
            "mode": mode_value,
            "session_key": session_key_value,
            "meta": meta or {},
            "created_at": created_at,
            "week_key": current_week_key(),
            "duplicate": False,
            "unique_key": unique_key_value,
        }

    def recent_scores(self, ip: str, limit: int = 20) -> List[Dict[str, Any]]:
        self.ensure_schema()
        take = max(1, min(int(limit or 20), 100))
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id, ip, game_id, score, mode, session_key, meta_json, created_at, week_key
                    FROM game_scores
                    WHERE ip = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT ?
                    """,
                    (ip, take),
                ).fetchall()
            finally:
                conn.close()
        return [self._score_row_to_dict(row, ip, "") for row in rows]

    def _selected_achievement_badge_from_state(self, state: Any) -> Dict[str, Any]:
        payload = state if isinstance(state, dict) else {}
        badge = payload.get("selectedAchievementBadgeMeta")
        if not isinstance(badge, dict):
            return {}
        badge_id = str(badge.get("id") or "").strip()
        glyph = str(badge.get("glyph") or "").strip()
        if not badge_id or not glyph:
            return {}
        return {
            "id": badge_id,
            "name": str(badge.get("name") or badge.get("label") or "").strip(),
            "short_name": str(badge.get("shortName") or "").strip(),
            "tier": str(badge.get("tier") or "").strip(),
            "glyph": glyph,
            "badge_text": str(badge.get("badgeText") or "").strip(),
            "group": str(badge.get("group") or "").strip(),
        }

    def achievement_badges_for_identities(self, identities: List[str]) -> Dict[str, Dict[str, Any]]:
        unique_identities = [str(item or "").strip() for item in identities if str(item or "").strip()]
        unique_identities = list(dict.fromkeys(unique_identities))
        if not unique_identities:
            return {}
        placeholders = ", ".join("?" for _ in unique_identities)
        params = ["topdown-shooter-meta", *unique_identities]
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    f"""
                    SELECT ip, state_json
                    FROM game_states
                    WHERE game_id = ? AND ip IN ({placeholders})
                    """,
                    params,
                ).fetchall()
            finally:
                conn.close()
        result: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            badge = self._selected_achievement_badge_from_state(self._decode_json(row["state_json"], {}))
            if badge:
                result[str(row["ip"] or "")] = badge
        return result

    def achievement_badge_for_identity(self, ip: str) -> Dict[str, Any]:
        return self.achievement_badges_for_identities([ip]).get(ip, {})

    def leaderboards(self, limit: int = 10) -> Dict[str, Any]:
        self.ensure_schema()
        take = max(1, min(int(limit or 10), 50))
        manifest = self.manifest()
        games = manifest.get("games", [])
        week_key = current_week_key()
        with _db_lock:
            conn = _connect()
            try:
                top_identity = self.top_total_score_identity()
                weekly_total_rows = conn.execute(
                    """
                    SELECT s.ip,
                           COALESCE(NULLIF(p.nickname, ''), '') AS nickname,
                           COALESCE(p.avatar_filename, '') AS avatar_filename,
                           SUM(s.score) AS total_score,
                           COUNT(*) AS play_count,
                           COALESCE(t.lifetime_score, 0) AS lifetime_score
                    FROM game_scores s
                    LEFT JOIN ip_profiles p ON p.ip = s.ip
                    LEFT JOIN (
                        SELECT ip, COALESCE(SUM(score), 0) AS lifetime_score
                        FROM game_scores
                        GROUP BY ip
                    ) t ON t.ip = s.ip
                    WHERE s.week_key = ?
                    GROUP BY s.ip
                    ORDER BY total_score DESC, play_count DESC, s.ip ASC
                    LIMIT ?
                    """,
                    (week_key, take),
                ).fetchall()

                all_time_recent_rows = conn.execute(
                    """
                    SELECT s.id,
                           s.ip,
                           s.game_id,
                           s.score,
                           s.mode,
                           s.created_at,
                           COALESCE(NULLIF(p.nickname, ''), '') AS nickname
                    FROM game_scores s
                    LEFT JOIN ip_profiles p ON p.ip = s.ip
                    ORDER BY s.created_at DESC, s.id DESC
                    LIMIT ?
                    """,
                    (take,),
                ).fetchall()

                per_game_weekly: Dict[str, List[Dict[str, Any]]] = {}
                for game in games:
                    game_id = normalize_game_id(game.get("id"))
                    rows = conn.execute(
                        """
                        SELECT s.ip,
                               COALESCE(NULLIF(p.nickname, ''), '') AS nickname,
                               MAX(s.score) AS best_score,
                               COUNT(*) AS play_count,
                               COALESCE(t.lifetime_score, 0) AS lifetime_score
                        FROM game_scores s
                        LEFT JOIN ip_profiles p ON p.ip = s.ip
                        LEFT JOIN (
                            SELECT ip, COALESCE(SUM(score), 0) AS lifetime_score
                            FROM game_scores
                            GROUP BY ip
                        ) t ON t.ip = s.ip
                        WHERE s.week_key = ? AND s.game_id = ?
                        GROUP BY s.ip
                        ORDER BY best_score DESC, play_count DESC, s.ip ASC
                        LIMIT ?
                        """,
                        (week_key, game_id, take),
                    ).fetchall()
                    per_game_weekly[game_id] = [
                        {
                            "ip": row["ip"],
                            "display_name": row["nickname"] or format_visitor_label(row["ip"]),
                            "best_score": row["best_score"],
                            "play_count": row["play_count"],
                            "lifetime_score": int(row["lifetime_score"] or 0),
                            "rank": rank_info_for_identity(row["ip"], row["lifetime_score"] or 0, top_identity),
                        }
                        for row in rows
                    ]
            finally:
                conn.close()

        badge_identities = [str(row["ip"] or "") for row in weekly_total_rows]
        badge_identities.extend(str(row["ip"] or "") for row in all_time_recent_rows)
        for rows in per_game_weekly.values():
            badge_identities.extend(str(row.get("ip") or "") for row in rows)
        achievement_badges = self.achievement_badges_for_identities(badge_identities)

        return {
            "week_key": week_key,
            "weekly_total": [
                {
                    "ip": row["ip"],
                    "display_name": row["nickname"] or format_visitor_label(row["ip"]),
                    "avatar_filename": row["avatar_filename"],
                    "total_score": row["total_score"],
                    "play_count": row["play_count"],
                    "lifetime_score": int(row["lifetime_score"] or 0),
                    "rank": rank_info_for_identity(row["ip"], row["lifetime_score"] or 0, top_identity),
                    "achievement_badge": achievement_badges.get(str(row["ip"] or ""), {}),
                }
                for row in weekly_total_rows
            ],
            "weekly_by_game": {
                game_id: [
                    dict(entry, achievement_badge=achievement_badges.get(str(entry.get("ip") or ""), {}))
                    for entry in rows
                ]
                for game_id, rows in per_game_weekly.items()
            },
            "recent_global": [
                {
                    "id": row["id"],
                    "ip": row["ip"],
                    "game_id": row["game_id"],
                    "score": row["score"],
                    "mode": row["mode"],
                    "created_at": row["created_at"],
                    "display_name": row["nickname"] or format_visitor_label(row["ip"]),
                    "achievement_badge": achievement_badges.get(str(row["ip"] or ""), {}),
                }
                for row in all_time_recent_rows
            ],
        }

    def manifest(self) -> Dict[str, Any]:
        payload = load_games_manifest()
        games: List[Dict[str, Any]] = []
        for item in payload.get("games", []):
            entry = dict(item)
            entry.setdefault("status", "ready")
            entry.setdefault("engine", "builtin")
            entry.setdefault("tags", [])
            games.append(entry)
        payload["games"] = games
        return payload

    def touch_presence(self, ip: str, current_game: Any = "", play_status: Any = "", room_code: Any = "") -> Dict[str, Any]:
        current_game_value = normalize_game_id(current_game)
        play_status_value = str(play_status or "").strip()[:64]
        room_code_value = str(room_code or "").strip().upper()[:16]
        timestamp = now_iso()
        self.ensure_schema()
        with _db_lock:
            conn = _connect()
            try:
                conn.execute(
                    """
                    INSERT INTO online_presence (ip, current_game, play_status, room_code, last_seen, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ip) DO UPDATE SET
                        current_game = excluded.current_game,
                        play_status = excluded.play_status,
                        room_code = excluded.room_code,
                        last_seen = excluded.last_seen,
                        updated_at = excluded.updated_at
                    """,
                    (ip, current_game_value, play_status_value, room_code_value, timestamp, timestamp),
                )
                conn.commit()
            finally:
                conn.close()
        return {
            "ip": ip,
            "current_game": current_game_value,
            "play_status": play_status_value,
            "room_code": room_code_value,
            "last_seen": timestamp,
        }

    def online_visitors(self, active_within_seconds: int = 120) -> List[Dict[str, Any]]:
        self.ensure_schema()
        active_within_seconds = max(10, min(int(active_within_seconds or 120), 3600))
        now_dt = datetime.now()
        top_identity = self.top_total_score_identity()
        rows: List[sqlite3.Row]
        with _db_lock:
            conn = _connect()
            try:
                rows = conn.execute(
                    """
                    SELECT o.ip,
                           o.current_game,
                           o.play_status,
                           o.room_code,
                           o.last_seen,
                           COALESCE(NULLIF(p.nickname, ''), '') AS nickname,
                           COALESCE(p.avatar_filename, '') AS avatar_filename,
                           COALESCE(t.total_score, 0) AS total_score
                    FROM online_presence o
                    LEFT JOIN ip_profiles p ON p.ip = o.ip
                    LEFT JOIN (
                        SELECT ip, COALESCE(SUM(score), 0) AS total_score
                        FROM game_scores
                        GROUP BY ip
                    ) t ON t.ip = o.ip
                    ORDER BY o.last_seen DESC, o.ip ASC
                    """
                ).fetchall()
            finally:
                conn.close()

        result: List[Dict[str, Any]] = []
        for row in rows:
            try:
                seen_dt = datetime.fromisoformat(row["last_seen"] or "")
            except Exception:
                continue
            age_seconds = int((now_dt - seen_dt).total_seconds())
            if age_seconds > active_within_seconds:
                continue
            result.append(
                {
                    "ip": row["ip"],
                    "identity": row["ip"],
                    "display_name": row["nickname"] or format_visitor_label(row["ip"]),
                    "avatar_filename": row["avatar_filename"],
                    "current_game": row["current_game"],
                    "play_status": row["play_status"],
                    "room_code": row["room_code"],
                    "total_score": int(row["total_score"] or 0),
                    "rank": rank_info_for_identity(row["ip"], row["total_score"] or 0, top_identity),
                    "last_seen": row["last_seen"],
                    "age_seconds": age_seconds,
                }
            )
        return result
