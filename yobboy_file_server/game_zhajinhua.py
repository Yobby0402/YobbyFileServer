from __future__ import annotations

import random
import secrets
import threading
from datetime import datetime
from typing import Any, Dict, List

from flask import request
from flask_socketio import join_room, leave_room

from .game_hub import GameHubStore, now_iso

ROOM_NAMESPACE = "/games-zhajinhua"
ROOM_TYPE = "zhajinhua"
CHAT_TTL_SECONDS = 20
MAX_BET_AMOUNT = 10_000_000
MAX_BASE_STAKE = MAX_BET_AMOUNT
MAX_PLAYERS = 10
DEFAULT_MAX_ROUNDS = 20
DEFAULT_BASE_STAKE = 5_000
DEFAULT_RAISE_OPTIONS = (1_000, 2_500, 5_000, 10_000, 25_000, 50_000)
SPECIAL_ROUND_PROBABILITY = 0.05

SUIT_ORDER = {
    "spades": 4,
    "hearts": 3,
    "clubs": 2,
    "diamonds": 1,
}

SUIT_SYMBOLS = {
    "spades": "♠",
    "hearts": "♥",
    "clubs": "♣",
    "diamonds": "♦",
}

SUIT_SHORT = {
    "spades": "S",
    "hearts": "H",
    "clubs": "C",
    "diamonds": "D",
}

HAND_KIND_LABELS = {
    "baozi": "豹子",
    "straight_flush": "顺金",
    "flush": "金花",
    "straight": "顺子",
    "pair": "对子",
    "high_card": "单张",
}


def _rank_label(rank: int) -> str:
    if rank == 14:
        return "A"
    if rank == 13:
        return "K"
    if rank == 12:
        return "Q"
    if rank == 11:
        return "J"
    return str(int(rank))


def _card_payload(rank: int, suit: str) -> Dict[str, Any]:
    suit_value = str(suit or "").strip().lower()
    if suit_value not in SUIT_ORDER:
        raise ValueError("Invalid suit")
    rank_value = int(rank)
    if rank_value < 2 or rank_value > 14:
        raise ValueError("Invalid rank")
    rank_label = _rank_label(rank_value)
    return {
        "rank": rank_value,
        "rank_label": rank_label,
        "suit": suit_value,
        "suit_symbol": SUIT_SYMBOLS[suit_value],
        "code": f"{rank_label}{SUIT_SHORT[suit_value]}",
        "label": f"{rank_label}{SUIT_SYMBOLS[suit_value]}",
    }


def build_zhajinhua_deck() -> List[Dict[str, Any]]:
    deck: List[Dict[str, Any]] = []
    for suit in ("spades", "hearts", "clubs", "diamonds"):
        for rank in range(2, 15):
            deck.append(_card_payload(rank, suit))
    return deck


def _normalize_cards(cards: Any) -> List[Dict[str, Any]]:
    payload = cards if isinstance(cards, list) else []
    result: List[Dict[str, Any]] = []
    for entry in payload[:3]:
        if not isinstance(entry, dict):
            continue
        try:
            result.append(_card_payload(int(entry.get("rank") or 0), str(entry.get("suit") or "")))
        except Exception:
            continue
    return result


def evaluate_zhajinhua_hand(
    cards: Any,
    *,
    a23_is_straight: bool = True,
    straight_gt_flush: bool = False,
) -> Dict[str, Any]:
    normalized = _normalize_cards(cards)
    if len(normalized) != 3:
        raise ValueError("炸金花需要 3 张牌")
    ordered = sorted(
        normalized,
        key=lambda item: (int(item["rank"]), SUIT_ORDER[str(item["suit"])]),
        reverse=True,
    )
    ranks = [int(item["rank"]) for item in ordered]
    suits = [str(item["suit"]) for item in ordered]
    is_flush = len(set(suits)) == 1
    unique_ranks = len(set(ranks)) == 3
    straight_high = 0
    if unique_ranks and ranks[0] - ranks[1] == 1 and ranks[1] - ranks[2] == 1:
        straight_high = ranks[0]
    elif unique_ranks and a23_is_straight and set(ranks) == {14, 3, 2}:
        straight_high = 3
    is_straight = straight_high > 0

    pair_rank = 0
    kicker_rank = 0
    if len(set(ranks)) == 2:
        for rank in ranks:
            if ranks.count(rank) == 2:
                pair_rank = rank
            else:
                kicker_rank = rank

    if len(set(ranks)) == 1:
        kind_key = "baozi"
        compare = [6, ranks[0]]
    elif is_straight and is_flush:
        kind_key = "straight_flush"
        compare = [5, straight_high]
    elif is_flush and not straight_gt_flush:
        kind_key = "flush"
        compare = [4, *ranks]
    elif is_straight:
        kind_key = "straight"
        compare = [4 if straight_gt_flush else 3, straight_high]
    elif is_flush:
        kind_key = "flush"
        compare = [3, *ranks]
    elif pair_rank:
        compare = [
            2,
            pair_rank,
            kicker_rank,
        ]
        kind_key = "pair"
    else:
        kind_key = "high_card"
        compare = [1, *ranks]

    return {
        "kind_key": kind_key,
        "kind_label": HAND_KIND_LABELS[kind_key],
        "cards": ordered,
        "compare": compare,
        "best_label": ordered[0]["label"],
        "is_special_235": kind_key == "high_card" and sorted(ranks) == [2, 3, 5],
    }


def compare_zhajinhua_hands(
    left_cards: Any,
    right_cards: Any,
    *,
    enable_235_rule: bool = False,
    a23_is_straight: bool = True,
    straight_gt_flush: bool = False,
) -> int:
    left_hand = evaluate_zhajinhua_hand(
        left_cards,
        a23_is_straight=a23_is_straight,
        straight_gt_flush=straight_gt_flush,
    )
    right_hand = evaluate_zhajinhua_hand(
        right_cards,
        a23_is_straight=a23_is_straight,
        straight_gt_flush=straight_gt_flush,
    )
    if enable_235_rule and left_hand["is_special_235"] and right_hand["kind_key"] == "baozi":
        return 1
    if enable_235_rule and right_hand["is_special_235"] and left_hand["kind_key"] == "baozi":
        return -1
    left_value = tuple(left_hand["compare"])
    right_value = tuple(right_hand["compare"])
    if left_value > right_value:
        return 1
    if left_value < right_value:
        return -1
    return 0
class ZhajinhuaManager:
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
            state.setdefault("host_player_id", players[0].get("player_id", ""))
            state.setdefault("status", "lobby")
            state.setdefault("base_stake", DEFAULT_BASE_STAKE)
            state.setdefault("pot", 0)
            state.setdefault("current_bet", 0)
            state.setdefault("dealer_player_id", "")
            state.setdefault("turn_player_id", "")
            state.setdefault("winner_player_id", "")
            state.setdefault("winner_label", "")
            state.setdefault("match_index", 0)
            state.setdefault("round_count", 0)
            state.setdefault("max_round", DEFAULT_MAX_ROUNDS)
            state.setdefault("enable_235_rule", False)
            state.setdefault("straight_gt_flush", False)
            state.setdefault("a23_is_straight", True)
            state.setdefault("raise_options", list(DEFAULT_RAISE_OPTIONS))
            state.setdefault("is_special_round", False)
            state.setdefault("finished_at", "")
            state.setdefault("compare_reveal_player_ids", [])
            state.setdefault("last_action", {})
            state.setdefault("history", [])
            state.setdefault("action_log", [])
            state.setdefault("chat_messages", [])
            state.setdefault("spectators", [])
            state.setdefault("created_at", now_iso())
            state.setdefault("updated_at", now_iso())
            for player in players:
                player["sid"] = ""
                player["is_online"] = False
                player.setdefault("is_ready", False)
                player.setdefault("cards", [])
                player.setdefault("hand_kind_key", "")
                player.setdefault("hand_kind_label", "")
                player.setdefault("is_folded", False)
                player.setdefault("is_dead", False)
                player.setdefault("is_seen", False)
                player.setdefault("total_bet", 0)
                player.setdefault("round_score_delta", 0)
                player["cosmetics"] = self._sanitize_cosmetics(player.get("cosmetics"))
                player.setdefault("joined_at", now_iso())
                player.setdefault("last_seen", now_iso())
            for spectator in state.get("spectators") or []:
                if isinstance(spectator, dict):
                    spectator["sid"] = ""
                    spectator["is_online"] = False
                    spectator["cosmetics"] = self._sanitize_cosmetics(spectator.get("cosmetics"))
                    spectator.setdefault("joined_at", now_iso())
                    spectator.setdefault("last_seen", now_iso())
            self._rooms[room_code] = state

    def _save_room(self, room: Dict[str, Any]) -> None:
        room["updated_at"] = now_iso()
        payload = dict(room)
        payload.pop("spectators", None)
        payload.pop("chat_messages", None)
        self._store.save_room_state(ROOM_TYPE, room["room_code"], payload)

    def _delete_room(self, room_code: str) -> None:
        self._rooms.pop(room_code, None)
        self._store.delete_room_state(ROOM_TYPE, room_code)

    def _make_room_code(self) -> str:
        while True:
            code = secrets.token_hex(2).upper()
            if code not in self._rooms:
                return code

    def _sanitize_cosmetics(self, cosmetics: Any) -> Dict[str, str]:
        payload = cosmetics if isinstance(cosmetics, dict) else {}
        return {
            "color_key": str(payload.get("color_key") or payload.get("colorKey") or "classic").strip()[:64] or "classic",
            "icon_key": str(payload.get("icon_key") or payload.get("iconKey") or "triangle").strip()[:64] or "triangle",
            "background_key": str(payload.get("background_key") or payload.get("backgroundKey") or "dojo").strip()[:64] or "dojo",
        }

    def _active_players(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [player for player in room.get("players") or [] if not player.get("removed")]

    def _active_spectators(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [spectator for spectator in (room.get("spectators") or []) if not spectator.get("removed")]

    def _remaining_players(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [player for player in self._active_players(room) if not player.get("is_folded")]

    def _online_player_count(self, room: Dict[str, Any]) -> int:
        return sum(1 for player in self._active_players(room) if player.get("is_online"))

    def _online_spectator_count(self, room: Dict[str, Any]) -> int:
        return sum(1 for spectator in self._active_spectators(room) if spectator.get("is_online"))

    def _online_count(self, room: Dict[str, Any]) -> int:
        return self._online_player_count(room) + self._online_spectator_count(room)

    def _find_player(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return next(
            (item for item in room.get("players") or [] if item.get("player_id") == player_id and not item.get("removed")),
            None,
        )

    def _find_spectator(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return next(
            (item for item in (room.get("spectators") or []) if item.get("player_id") == player_id and not item.get("removed")),
            None,
        )

    def _room_member(self, room: Dict[str, Any], player_id: str) -> Dict[str, Any] | None:
        return self._find_player(room, player_id) or self._find_spectator(room, player_id)

    def _player_label(self, player: Dict[str, Any] | None) -> str:
        return str((player or {}).get("display_name") or "玩家")

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
        room["chat_messages"] = self._prune_timed_entries(list(room.get("chat_messages") or []), CHAT_TTL_SECONDS)[-30:]
        return room["chat_messages"]

    def _append_action_log(
        self,
        room: Dict[str, Any],
        text: str,
        actor_player_id: str = "",
        action_key: str = "system",
    ) -> None:
        entry = {
            "log_id": secrets.token_hex(6),
            "actor_player_id": actor_player_id,
            "action_key": action_key,
            "text": str(text or "").strip()[:240],
            "created_at": now_iso(),
        }
        room.setdefault("action_log", [])
        room["action_log"] = (room.get("action_log") or [])[-29:] + [entry]
        room["last_action"] = entry

    def _serialize_hand(self, player: Dict[str, Any]) -> List[Dict[str, Any]]:
        return _normalize_cards(player.get("cards"))

    def _evaluate_player_hand(self, room: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, Any]:
        return evaluate_zhajinhua_hand(
            player.get("cards") or [],
            a23_is_straight=bool(room.get("a23_is_straight", True)),
            straight_gt_flush=bool(room.get("straight_gt_flush", False)),
        )

    def _hand_compare(self, room: Dict[str, Any], player: Dict[str, Any]) -> tuple:
        evaluated = self._evaluate_player_hand(room, player)
        player["hand_compare"] = list(evaluated["compare"])
        player["hand_kind_key"] = evaluated["kind_key"]
        player["hand_kind_label"] = evaluated["kind_label"]
        return tuple(evaluated["compare"])

    def _total_score(self, player_id: str) -> int:
        summary = self._store.total_score_summary(str(player_id or "").strip())
        return int((summary or {}).get("total_score") or 0)

    def _score_cache_for_room(self, room: Dict[str, Any], extra_ids: List[str] | None = None) -> Dict[str, int]:
        player_ids = [str(player.get("player_id") or "").strip() for player in self._active_players(room)]
        spectator_ids = [str(spectator.get("player_id") or "").strip() for spectator in self._active_spectators(room)]
        payload = self._store.total_score_summaries(player_ids + spectator_ids + list(extra_ids or []))
        return {
            identity: int((summary or {}).get("total_score") or 0)
            for identity, summary in (payload or {}).items()
        }

    def _score_locked(self, player_id: str) -> bool:
        return self._total_score(player_id) < 0

    def _ensure_score_unlocked(self, player_id: str, label: str = "player") -> None:
        if self._score_locked(player_id):
            raise ValueError(f"{label} 当前积分为负，请先去其他游戏赚回正数后再继续上桌")

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

    def _consume_points(self, room: Dict[str, Any], player: Dict[str, Any], amount: int, action_key: str) -> None:
        amount_value = max(0, int(amount or 0))
        if amount_value <= 0:
            return
        player_id = str(player.get("player_id") or "")
        room["pot"] = int(room.get("pot") or 0) + amount_value
        player["total_bet"] = int(player.get("total_bet") or 0) + amount_value
        player["round_score_delta"] = int(player.get("round_score_delta") or 0) - amount_value
        self._record_score_delta(
            player_id,
            -amount_value,
            f"{ROOM_TYPE}:{room['room_code']}:{int(room.get('match_index') or 0)}:{action_key}:{player_id}:{int(player.get('total_bet') or 0)}",
            {
                "room_code": room["room_code"],
                "match_index": int(room.get("match_index") or 0),
                "action_key": action_key,
                "score_delta": -amount_value,
                "player_label": self._player_label(player),
                "pot_after": int(room.get("pot") or 0),
            },
        )

    def _step_bet_amount(self, room: Dict[str, Any], player: Dict[str, Any]) -> int:
        current_bet = max(1, int(room.get("current_bet") or room.get("base_stake") or 1))
        return min(current_bet * (2 if player.get("is_seen") else 1), self._max_bet_amount())

    def _compare_cost(self, room: Dict[str, Any]) -> int:
        current_bet = max(1, int(room.get("current_bet") or room.get("base_stake") or 1))
        return min(current_bet * 2, self._max_bet_amount())

    def _raise_options(self, room: Dict[str, Any]) -> List[int]:
        payload = room.get("raise_options")
        values = payload if isinstance(payload, list) else list(DEFAULT_RAISE_OPTIONS)
        result: List[int] = []
        for item in values:
            amount = max(1, int(item or 0))
            if amount <= self._max_bet_amount() and amount not in result:
                result.append(amount)
        return result or list(DEFAULT_RAISE_OPTIONS)

    def _max_bet_amount(self) -> int:
        return max(1, int(MAX_BET_AMOUNT))

    def _special_round_probability(self) -> float:
        return min(1.0, max(0.0, float(SPECIAL_ROUND_PROBABILITY)))

    def _deal_regular_match_hands(self, room: Dict[str, Any], players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deck = build_zhajinhua_deck()
        random.shuffle(deck)
        return [evaluate_zhajinhua_hand(
            [deck.pop(), deck.pop(), deck.pop()],
            a23_is_straight=bool(room.get("a23_is_straight", True)),
            straight_gt_flush=bool(room.get("straight_gt_flush", False)),
        ) for _ in players]

    def _deal_special_match_hands(self, room: Dict[str, Any], players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        cards_by_rank: Dict[int, List[Dict[str, Any]]] = {}
        for card in build_zhajinhua_deck():
            cards_by_rank.setdefault(int(card["rank"]), []).append(card)
        for rank_cards in cards_by_rank.values():
            random.shuffle(rank_cards)
        pair_ranks: List[int] = []
        for rank, rank_cards in cards_by_rank.items():
            pair_ranks.extend([rank] * (len(rank_cards) // 2))
        random.shuffle(pair_ranks)
        if len(pair_ranks) < len(players):
            raise ValueError("特殊牌局发牌失败")
        prepared_hands: List[Dict[str, Any]] = []
        for pair_rank in pair_ranks[:len(players)]:
            prepared_hands.append({
                "pair_rank": pair_rank,
                "cards": [cards_by_rank[pair_rank].pop(), cards_by_rank[pair_rank].pop()],
            })
        remaining_cards: List[Dict[str, Any]] = []
        for rank_cards in cards_by_rank.values():
            remaining_cards.extend(rank_cards)
        random.shuffle(remaining_cards)
        for hand in prepared_hands:
            kicker_index = next((
                index for index, card in enumerate(remaining_cards)
                if int(card["rank"]) != int(hand["pair_rank"])
            ), -1)
            if kicker_index < 0:
                raise ValueError("特殊牌局补牌失败")
            hand["cards"].append(remaining_cards.pop(kicker_index))
            random.shuffle(hand["cards"])
        return [evaluate_zhajinhua_hand(
            hand["cards"],
            a23_is_straight=bool(room.get("a23_is_straight", True)),
            straight_gt_flush=bool(room.get("straight_gt_flush", False)),
        ) for hand in prepared_hands]

    def _player_index(self, room: Dict[str, Any], player_id: str) -> int:
        for index, player in enumerate(self._active_players(room)):
            if str(player.get("player_id") or "") == str(player_id or ""):
                return index
        return -1

    def _next_turn_player(self, room: Dict[str, Any], from_player_id: str) -> Dict[str, Any] | None:
        ordered = list(room.get("players") or [])
        if not ordered:
            return None
        remaining = [player for player in ordered if not player.get("removed") and not player.get("is_folded")]
        if len(remaining) <= 1:
            return remaining[0] if remaining else None
        start_index = -1
        for index, player in enumerate(ordered):
            if str(player.get("player_id") or "") == str(from_player_id or ""):
                start_index = index
                break
        for offset in range(1, len(ordered) + 1):
            candidate = ordered[(start_index + offset) % len(ordered)] if start_index >= 0 else ordered[offset - 1]
            if candidate.get("removed") or candidate.get("is_folded"):
                continue
            return candidate
        return remaining[0]

    def _advance_turn(self, room: Dict[str, Any], from_player_id: str) -> None:
        next_player = self._next_turn_player(room, from_player_id)
        room["turn_player_id"] = str((next_player or {}).get("player_id") or "")

    def _finish_showdown(self, room: Dict[str, Any], reason: str = "max_round") -> None:
        remaining = self._remaining_players(room)
        if not remaining:
            self._finish_match(room, "", reason=reason)
            return
        winner = remaining[0]
        for player in remaining[1:]:
            if compare_zhajinhua_hands(
                player.get("cards") or [],
                winner.get("cards") or [],
                enable_235_rule=bool(room.get("enable_235_rule", False)),
                a23_is_straight=bool(room.get("a23_is_straight", True)),
                straight_gt_flush=bool(room.get("straight_gt_flush", False)),
            ) > 0:
                winner = player
        self._finish_match(room, winner["player_id"], reason=reason)

    def _advance_after_action(self, room: Dict[str, Any], from_player_id: str, reason: str) -> None:
        remaining = self._remaining_players(room)
        if len(remaining) == 1:
            self._finish_match(room, remaining[0]["player_id"], reason=reason)
            return
        current_round = max(1, int(room.get("round_count") or 1))
        max_round = max(1, int(room.get("max_round") or DEFAULT_MAX_ROUNDS))
        if current_round >= max_round:
            self._finish_showdown(room, reason="max_round")
            return
        room["round_count"] = current_round + 1
        self._advance_turn(room, from_player_id)

    def _reset_round_state(self, room: Dict[str, Any]) -> None:
        room["pot"] = 0
        room["current_bet"] = max(0, int(room.get("base_stake") or 0))
        room["round_count"] = 0
        room["dealer_player_id"] = ""
        room["turn_player_id"] = ""
        room["winner_player_id"] = ""
        room["winner_label"] = ""
        room["finished_at"] = ""
        room["compare_reveal_player_ids"] = []
        room["last_action"] = {}
        room["action_log"] = []
        for player in self._active_players(room):
            player["cards"] = []
            player["hand_compare"] = []
            player["hand_kind_key"] = ""
            player["hand_kind_label"] = ""
            player["is_folded"] = False
            player["is_dead"] = False
            player["is_seen"] = False
            player["total_bet"] = 0
            player["round_score_delta"] = 0

    def _begin_match(self, room: Dict[str, Any], players: List[Dict[str, Any]]) -> None:
        room["match_index"] = int(room.get("match_index") or 0) + 1
        room["status"] = "playing"
        room["is_special_round"] = random.random() < self._special_round_probability()
        room["winner_player_id"] = ""
        room["winner_label"] = ""
        room["finished_at"] = ""
        room["compare_reveal_player_ids"] = []
        room["action_log"] = []
        room["last_action"] = {}
        dealer_index = (int(room.get("match_index") or 1) - 1) % len(players)
        dealer = players[dealer_index]
        first_turn = players[(dealer_index + 1) % len(players)] if len(players) > 1 else dealer
        room["dealer_player_id"] = dealer["player_id"]
        room["turn_player_id"] = first_turn["player_id"]
        room["round_count"] = 1
        room["pot"] = 0
        room["current_bet"] = min(max(1, int(room.get("base_stake") or 1)), self._max_bet_amount())
        dealt_hands = self._deal_special_match_hands(room, players) if room.get("is_special_round") else self._deal_regular_match_hands(room, players)
        for player, hand in zip(players, dealt_hands):
            player["cards"] = hand["cards"]
            player["hand_compare"] = list(hand["compare"])
            player["hand_kind_key"] = hand["kind_key"]
            player["hand_kind_label"] = hand["kind_label"]
            player["is_folded"] = False
            player["is_dead"] = False
            player["is_seen"] = False
            player["is_ready"] = False
            player["total_bet"] = 0
            player["round_score_delta"] = 0
            self._consume_points(room, player, int(room.get("base_stake") or 0), "ante")
        self._append_action_log(
            room,
            f"新一局开始，底金 {int(room.get('base_stake') or 0)}，已重新洗牌发牌。",
            action_key="start",
        )

    def _finish_match(self, room: Dict[str, Any], winner_player_id: str, reason: str = "fold") -> None:
        winner = self._find_player(room, str(winner_player_id or ""))
        remaining = self._remaining_players(room)
        if not winner and remaining:
            winner = remaining[0]
            winner_player_id = winner["player_id"]
        room["status"] = "finished"
        room["turn_player_id"] = ""
        room["winner_player_id"] = str(winner_player_id or "")
        room["winner_label"] = self._player_label(winner) if winner else ""
        room["finished_at"] = now_iso()
        pot_value = max(0, int(room.get("pot") or 0))
        score_changes: Dict[str, int] = {}
        if winner and pot_value > 0:
            winner["round_score_delta"] = int(winner.get("round_score_delta") or 0) + pot_value
            score_changes[winner["player_id"]] = pot_value
            self._record_score_delta(
                winner["player_id"],
                pot_value,
                f"{ROOM_TYPE}:{room['room_code']}:{int(room.get('match_index') or 0)}:winner:{winner['player_id']}",
                {
                    "room_code": room["room_code"],
                    "match_index": int(room.get("match_index") or 0),
                    "action_key": "winner",
                    "score_delta": pot_value,
                    "reason": reason,
                    "player_label": self._player_label(winner),
                    "pot": pot_value,
                },
            )
        self._append_action_log(
            room,
            f"{room.get('winner_label') or '本局'} 获胜，奖池 {pot_value}。"
            + (" 本局为爽局。" if room.get("is_special_round") else ""),
            actor_player_id=str((winner or {}).get("player_id") or ""),
            action_key="finish",
        )
        history_entry = {
            "match_index": int(room.get("match_index") or 0),
            "winner_player_id": str(winner_player_id or ""),
            "winner_label": room.get("winner_label") or "",
            "pot": pot_value,
            "finish_reason": reason,
            "is_special_round": bool(room.get("is_special_round")),
            "finished_at": now_iso(),
            "score_changes": score_changes,
            "players": [{
                "player_id": player["player_id"],
                "display_name": player["display_name"],
                "is_seen": bool(player.get("is_seen")),
                "is_folded": bool(player.get("is_folded")),
                "total_bet": int(player.get("total_bet") or 0),
                "hand_kind_label": str(player.get("hand_kind_label") or ""),
                "cards": self._serialize_hand(player),
            } for player in self._active_players(room)],
        }
        room["history"] = (room.get("history") or [])[-11:] + [history_entry]
        self._store.record_room_record(ROOM_TYPE, room["room_code"], history_entry)
        for player in self._active_players(room):
            player["is_ready"] = False

    def _remove_player_from_room(self, room: Dict[str, Any], player_id: str, mark_removed: bool) -> bool:
        player = self._find_player(room, player_id)
        if not player:
            return False
        player["sid"] = ""
        player["is_online"] = False
        player["last_seen"] = now_iso()
        player["is_ready"] = False
        if mark_removed:
            player["removed"] = True
        active_players = self._active_players(room)
        if not active_players:
            self._delete_room(room["room_code"])
            return True
        if room.get("host_player_id") == player_id:
            room["host_player_id"] = active_players[0]["player_id"]
        self._save_room(room)
        return True

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

    def _public_player(self, room: Dict[str, Any], player: Dict[str, Any], viewer_player_id: str | None, score_cache: Dict[str, int] | None = None) -> Dict[str, Any]:
        compare_reveal_ids = {
            str(item or "")
            for item in (room.get("compare_reveal_player_ids") or [])
        }
        viewer_id = str(viewer_player_id or "")
        player_id = str(player.get("player_id") or "")
        is_self = player_id == viewer_id
        can_view_compare_reveal = bool(viewer_id) and viewer_id in compare_reveal_ids
        player_score = int((score_cache or {}).get(str(player.get("player_id") or "").strip(), self._total_score(player["player_id"])))
        reveal_cards = bool(
            room.get("status") == "finished"
            or (can_view_compare_reveal and player_id in compare_reveal_ids)
            or (is_self and player.get("is_seen"))
        )
        payload = {
            "player_id": player["player_id"],
            "display_name": player["display_name"],
            "avatar_url": player.get("avatar_url", ""),
            "total_score": player_score,
            "is_online": bool(player.get("is_online")),
            "is_ready": bool(player.get("is_ready")),
            "is_folded": bool(player.get("is_folded")),
            "is_dead": bool(player.get("is_dead")),
            "is_seen": bool(player.get("is_seen")),
            "total_bet": int(player.get("total_bet") or 0),
            "current_bet": int(player.get("total_bet") or 0),
            "round_score_delta": int(player.get("round_score_delta") or 0),
            "joined_at": player.get("joined_at", ""),
            "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
            "seat_index": self._player_index(room, player["player_id"]),
            "card_count": len(self._serialize_hand(player)),
            "hand_kind_label": str(player.get("hand_kind_label") or "") if reveal_cards else "",
            "is_revealed": reveal_cards,
            "is_score_locked": player_score < 0,
        }
        if reveal_cards:
            payload["cards"] = self._serialize_hand(player)
        return payload

    def _public_room(self, room: Dict[str, Any], viewer_player_id: str | None = None, score_cache: Dict[str, int] | None = None) -> Dict[str, Any]:
        active_players = self._active_players(room)
        local_score_cache = score_cache or self._score_cache_for_room(room, [str(viewer_player_id or "").strip()])
        players = [self._public_player(room, player, viewer_player_id, local_score_cache) for player in active_players]
        payload = {
            "room_code": room["room_code"],
            "status": room.get("status", "lobby"),
            "host_player_id": room.get("host_player_id", ""),
            "dealer_player_id": room.get("dealer_player_id", ""),
            "dealer_index": self._player_index(room, room.get("dealer_player_id", "")),
            "turn_player_id": room.get("turn_player_id", ""),
            "current_turn_index": self._player_index(room, room.get("turn_player_id", "")),
            "winner_player_id": room.get("winner_player_id", ""),
            "winner_label": room.get("winner_label", ""),
            "base_stake": int(room.get("base_stake") or 0),
            "pot": int(room.get("pot") or 0),
            "current_bet": int(room.get("current_bet") or 0),
            "match_index": int(room.get("match_index") or 0),
            "round_count": int(room.get("round_count") or 0),
            "max_round": int(room.get("max_round") or DEFAULT_MAX_ROUNDS),
            "raise_options": self._raise_options(room),
            "enable_235_rule": bool(room.get("enable_235_rule", False)),
            "straight_gt_flush": bool(room.get("straight_gt_flush", False)),
            "a23_is_straight": bool(room.get("a23_is_straight", True)),
            "max_bet_amount": self._max_bet_amount(),
            "special_round_probability": self._special_round_probability(),
            "finished_at": str(room.get("finished_at") or ""),
            "last_action": room.get("last_action") or {},
            "history": list(room.get("history") or []),
            "action_log": list(room.get("action_log") or []),
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
        }
        payload["can_start"] = (
            room.get("status") != "playing"
            and len(players) >= 2
            and len(players) <= MAX_PLAYERS
            and int(room.get("base_stake") or 0) > 0
            and all(not player.get("is_score_locked") for player in players)
            and (
                room.get("status") == "finished"
                or all(player.get("is_ready") for player in active_players)
            )
        )
        if viewer_player_id:
            player = self._find_player(room, viewer_player_id)
            spectator = self._find_spectator(room, viewer_player_id)
            payload["self_player_id"] = viewer_player_id
            payload["self_role"] = "player" if player else ("spectator" if spectator else "")
            payload["self_total_score"] = int(local_score_cache.get(str(viewer_player_id or "").strip(), self._total_score(viewer_player_id)))
        if room.get("status") == "finished":
            payload["is_special_round"] = bool(room.get("is_special_round"))
        return payload

    def room_snapshots(self, room_code: str) -> List[Dict[str, Any]]:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                return []
            score_cache = self._score_cache_for_room(room)
            snapshots: List[Dict[str, Any]] = []
            for player in self._active_players(room):
                sid = str(player.get("sid") or "").strip()
                if sid:
                    snapshots.append({"sid": sid, "payload": self._public_room(room, player["player_id"], score_cache)})
            for spectator in self._active_spectators(room):
                sid = str(spectator.get("sid") or "").strip()
                if sid:
                    snapshots.append({"sid": sid, "payload": self._public_room(room, spectator["player_id"], score_cache)})
            return snapshots

    def dissolve_room(self, room_code: str, player_id: str) -> None:
        with self._lock:
            code = str(room_code or "").strip().upper()
            room = self._rooms.get(code)
            if not room:
                raise ValueError("Room not found")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以解散房间")
            self._delete_room(code)

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
                    "base_stake": int(room.get("base_stake") or 0),
                    "pot": int(room.get("pot") or 0),
                    "match_index": int(room.get("match_index") or 0),
                    "players": [{
                        "player_id": player["player_id"],
                        "display_name": player["display_name"],
                        "is_online": bool(player.get("is_online")),
                        "is_ready": bool(player.get("is_ready")),
                        "is_folded": bool(player.get("is_folded")),
                        "is_seen": bool(player.get("is_seen")),
                        "total_bet": int(player.get("total_bet") or 0),
                        "cosmetics": self._sanitize_cosmetics(player.get("cosmetics")),
                    } for player in players],
                    "player_count": len(players),
                    "online_player_count": self._online_player_count(room),
                    "online_spectator_count": self._online_spectator_count(room),
                    "online_count": self._online_count(room),
                    "spectator_count": len(self._active_spectators(room)),
                    "max_bet_amount": self._max_bet_amount(),
                    "special_round_probability": self._special_round_probability(),
                    "updated_at": room.get("updated_at", ""),
                })
            return items

    def global_records(self, limit: int = 120) -> List[Dict[str, Any]]:
        with self._lock:
            records = []
            for item in self._store.list_room_records(ROOM_TYPE, limit=limit):
                payload = item.get("record") if isinstance(item.get("record"), dict) else {}
                record = dict(payload)
                record["record_id"] = int(item.get("record_id") or 0)
                record["room_code"] = str(record.get("room_code") or item.get("room_code") or "").strip().upper()
                record["recorded_at"] = str(item.get("created_at") or "")
                records.append(record)
            return records

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
                    "base_stake": DEFAULT_BASE_STAKE,
                    "pot": 0,
                    "current_bet": 0,
                    "dealer_player_id": "",
                    "turn_player_id": "",
                    "winner_player_id": "",
                    "winner_label": "",
                    "match_index": 0,
                    "round_count": 0,
                    "max_round": DEFAULT_MAX_ROUNDS,
                    "enable_235_rule": False,
                    "straight_gt_flush": False,
                    "a23_is_straight": True,
                    "raise_options": list(DEFAULT_RAISE_OPTIONS),
                    "is_special_round": False,
                    "finished_at": "",
                    "compare_reveal_player_ids": [],
                    "last_action": {},
                    "history": [],
                    "action_log": [],
                    "chat_messages": [],
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
            cosmetics_payload = self._sanitize_cosmetics(cosmetics)
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
                            "cosmetics": cosmetics_payload,
                        })
                    else:
                        spectator["sid"] = sid
                        spectator["ip"] = ip
                        spectator["display_name"] = display_name
                        spectator["avatar_url"] = avatar_url
                        spectator["last_seen"] = now_iso()
                        spectator["is_online"] = True
                        spectator["removed"] = False
                        spectator["cosmetics"] = cosmetics_payload
                    self._save_room(room)
                    return self._public_room(room, player_id_value)
                if spectator:
                    spectator["sid"] = ""
                    spectator["is_online"] = False
                    spectator["removed"] = True
                if room.get("status") == "playing":
                    raise ValueError("鐗屽眬杩涜涓紝璇峰厛瑙傛垬")
                if len(active_players) >= MAX_PLAYERS:
                    raise ValueError("鎴块棿宸叉弧")
                self._ensure_score_unlocked(player_id_value, display_name or "该玩家")
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
                    "cards": [],
                    "hand_compare": [],
                    "hand_kind_key": "",
                    "hand_kind_label": "",
                    "is_folded": False,
                    "is_dead": False,
                    "is_seen": False,
                    "total_bet": 0,
                    "round_score_delta": 0,
                    "cosmetics": cosmetics_payload,
                })
            else:
                player["sid"] = sid
                player["ip"] = ip
                player["display_name"] = display_name
                player["avatar_url"] = avatar_url
                player["last_seen"] = now_iso()
                player["is_online"] = True
                player["cosmetics"] = self._sanitize_cosmetics(cosmetics or player.get("cosmetics"))
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
            if room.get("status") == "playing" and not player.get("is_folded"):
                player["is_folded"] = True
                self._append_action_log(room, f"{self._player_label(player)} 离开了牌桌。", player_id, "leave")
            self._remove_player_from_room(room, player_id, mark_removed=True)
            refreshed = self._rooms.get(room["room_code"])
            if not refreshed:
                return None
            remaining = self._remaining_players(refreshed)
            if refreshed.get("status") == "playing" and len(remaining) == 1:
                self._finish_match(refreshed, remaining[0]["player_id"], reason="leave")
            elif refreshed.get("status") == "playing" and refreshed.get("turn_player_id") == player_id:
                self._advance_turn(refreshed, player_id)
            self._save_room(refreshed)
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
                if room.get("status") == "playing" and not player.get("is_folded"):
                    player["is_folded"] = True
                    self._append_action_log(room, f"{self._player_label(player)} 转为观战。", player_id, "spectate")
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
                    "joined_at": player.get("joined_at") or now_iso(),
                    "last_seen": now_iso(),
                    "is_online": True,
                    "removed": False,
                    "cosmetics": cosmetics_payload,
                })
                remaining = self._remaining_players(refreshed)
                if refreshed.get("status") == "playing" and len(remaining) == 1:
                    self._finish_match(refreshed, remaining[0]["player_id"], reason="spectate")
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
                self._save_room(room)
                return self._public_room(room, player_id)
            if not spectator:
                raise ValueError("玩家不在房间中")
            if room.get("status") == "playing":
                raise ValueError("鐗屽眬杩涜涓彧鑳借鎴?")
            active_players = self._active_players(room)
            if len(active_players) >= MAX_PLAYERS:
                raise ValueError("鐗屾宸叉弧")
            self._ensure_score_unlocked(player_id, display_name or "该玩家")
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
                "cards": [],
                "hand_compare": [],
                "hand_kind_key": "",
                "hand_kind_label": "",
                "is_folded": False,
                "is_dead": False,
                "is_seen": False,
                "total_bet": 0,
                "round_score_delta": 0,
                "cosmetics": cosmetics_payload,
            })
            if not self._find_player(room, room.get("host_player_id", "")):
                room["host_player_id"] = player_id
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
                raise ValueError("牌局进行中，无法修改准备状态")
            player = self._find_player(room, player_id)
            if not player:
                raise ValueError("玩家不在房间中")
            self._ensure_score_unlocked(player_id, self._player_label(player))
            player["is_ready"] = not bool(player.get("is_ready"))
            self._save_room(room)

    def set_base_stake(self, room_code: str, player_id: str, amount: int) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以设置底金")
            if room.get("status") == "playing":
                raise ValueError("牌局进行中，无法修改底金")
            stake = max(1, min(int(amount or 0), self._max_bet_amount()))
            room["base_stake"] = stake
            self._save_room(room)

    def update_cosmetics(self, room_code: str, player_id: str, cosmetics: Dict[str, Any] | None) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            member = self._room_member(room, player_id)
            if not member:
                raise ValueError("玩家不在房间中")
            member["cosmetics"] = self._sanitize_cosmetics(cosmetics)
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
            self._save_room(room)
            return entry

    def start_match(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("host_player_id") != player_id:
                raise ValueError("只有房主可以开始")
            if room.get("status") == "playing":
                raise ValueError("当前牌局正在进行")
            players = self._active_players(room)
            if len(players) < 2:
                raise ValueError("炸金花至少需要 2 名玩家")
            if len(players) > MAX_PLAYERS:
                raise ValueError(f"单局最多 {MAX_PLAYERS} 人")
            base_stake = max(0, int(room.get("base_stake") or 0))
            if base_stake <= 0:
                raise ValueError("请先设置底金")
            if room.get("status") != "finished" and not all(player.get("is_ready") for player in players):
                raise ValueError("所有上桌玩家都准备后才能开始")
            for player in players:
                self._ensure_score_unlocked(player.get("player_id", ""), self._player_label(player))
            self._begin_match(room, players)
            self._save_room(room)

    def look_cards(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在牌局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你操作")
            player = self._find_player(room, player_id)
            if not player or player.get("is_folded"):
                raise ValueError("当前无法看牌")
            if not player.get("is_seen"):
                player["is_seen"] = True
                self._append_action_log(room, f"{self._player_label(player)} 看牌。", player_id, "look")
                self._save_room(room)

    def follow_bet(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在牌局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你操作")
            player = self._find_player(room, player_id)
            if not player or player.get("is_folded"):
                raise ValueError("当前无法跟注")
            amount = self._step_bet_amount(room, player)
            self._consume_points(room, player, amount, "follow")
            self._append_action_log(
                room,
                f"{self._player_label(player)} {'看牌跟注' if player.get('is_seen') else '闷跟'} {amount}。",
                player_id,
                "follow",
            )
            self._advance_after_action(room, player_id, "follow")
            self._save_room(room)

    def raise_bet(self, room_code: str, player_id: str, amount: int) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在牌局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你操作")
            player = self._find_player(room, player_id)
            if not player or player.get("is_folded"):
                raise ValueError("当前无法加注")
            raise_to = max(1, int(amount or 0))
            if raise_to > self._max_bet_amount():
                raise ValueError(f"加注上限不能超过 {self._max_bet_amount()}")
            if raise_to <= int(room.get("current_bet") or 0):
                raise ValueError("鍔犳敞鍚庣殑褰撳墠娉ㄥ繀椤诲ぇ浜庣幇鍦ㄧ殑娉ㄩ")
            room["current_bet"] = raise_to
            pay_amount = self._step_bet_amount(room, player)
            self._consume_points(room, player, pay_amount, "raise")
            self._append_action_log(
                room,
                f"{self._player_label(player)} 加注到 {int(room.get('current_bet') or 0)}，本次支付 {pay_amount}。",
                player_id,
                "raise",
            )
            self._advance_after_action(room, player_id, "raise")
            self._save_room(room)

    def compare_with(self, room_code: str, player_id: str, target_player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在牌局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你操作")
            player = self._find_player(room, player_id)
            target = self._find_player(room, str(target_player_id or "").strip())
            if not player or player.get("is_folded"):
                raise ValueError("当前无法比牌")
            if not target or target.get("is_folded"):
                raise ValueError("目标玩家不可比牌")
            if player["player_id"] == target["player_id"]:
                raise ValueError("不能和自己比牌")
            amount = self._compare_cost(room)
            self._consume_points(room, player, amount, "compare")
            left_compare = self._hand_compare(room, player)
            right_compare = self._hand_compare(room, target)
            loser = target if left_compare > right_compare else player
            winner = player if loser is target else target
            loser["is_folded"] = True
            loser["is_dead"] = True
            room["compare_reveal_player_ids"] = [player["player_id"], target["player_id"]]
            self._append_action_log(
                room,
                f"{self._player_label(player)} 与 {self._player_label(target)} 比牌，{self._player_label(winner)} 胜出。",
                player_id,
                "compare",
            )
            self._advance_after_action(room, player_id, "compare")
            self._save_room(room)

    def fold_player(self, room_code: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(str(room_code or "").strip().upper())
            if not room:
                raise ValueError("房间不存在")
            if room.get("status") != "playing":
                raise ValueError("当前不在牌局中")
            if room.get("turn_player_id") != player_id:
                raise ValueError("还没轮到你操作")
            player = self._find_player(room, player_id)
            if not player or player.get("is_folded"):
                raise ValueError("当前无法弃牌")
            player["is_folded"] = True
            self._append_action_log(room, f"{self._player_label(player)} 弃牌。", player_id, "fold")
            self._advance_after_action(room, player_id, "fold")
            self._save_room(room)


zhajinhua_manager = ZhajinhuaManager()


def init_zhajinhua_socketio(socketio, profile_resolver):
    def _emit_room(room_code: str) -> None:
        for snapshot in zhajinhua_manager.room_snapshots(room_code):
            socketio.emit("zhajinhua_room", snapshot["payload"], room=snapshot["sid"], namespace=ROOM_NAMESPACE)

    def _emit_rooms(target_sid: str | None = None) -> None:
        payload = zhajinhua_manager.room_summaries()
        if target_sid:
            socketio.emit("zhajinhua_rooms", payload, room=target_sid, namespace=ROOM_NAMESPACE)
            return
        socketio.emit("zhajinhua_rooms", payload, namespace=ROOM_NAMESPACE)

    def _emit_rooms_async() -> None:
        socketio.start_background_task(_emit_rooms)

    def _emit_records(target_sid: str | None = None) -> None:
        payload = zhajinhua_manager.global_records()
        if target_sid:
            socketio.emit("zhajinhua_records", payload, room=target_sid, namespace=ROOM_NAMESPACE)
            return
        socketio.emit("zhajinhua_records", payload, namespace=ROOM_NAMESPACE)

    def _emit_records_async() -> None:
        socketio.start_background_task(_emit_records)

    @socketio.on("connect", namespace=ROOM_NAMESPACE)
    def zhajinhua_connect():
        socketio.emit("zhajinhua_connected", {"sid": request.sid}, room=request.sid, namespace=ROOM_NAMESPACE)
        _emit_rooms(request.sid)
        _emit_records(request.sid)

    @socketio.on("disconnect", namespace=ROOM_NAMESPACE)
    def zhajinhua_disconnect():
        affected_rooms = zhajinhua_manager.disconnect_player(request.sid)
        for room_code in affected_rooms:
            _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_join", namespace=ROOM_NAMESPACE)
    def zhajinhua_join(data):
        payload = dict(data or {})
        profile = profile_resolver(request)
        previous_rooms = zhajinhua_manager.rooms_for_player(profile["identity"])
        room_code = str(payload.get("room_code") or "").strip().upper()
        cosmetics = payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {}
        try:
            room_payload = zhajinhua_manager.create_or_join_room(
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
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        for previous_room_code in previous_rooms:
            if previous_room_code and previous_room_code != room_payload["room_code"]:
                leave_room(previous_room_code)
        join_room(room_payload["room_code"])
        socketio.emit("zhajinhua_room", room_payload, room=request.sid, namespace=ROOM_NAMESPACE)
        for previous_room_code in previous_rooms:
            if previous_room_code and previous_room_code != room_payload["room_code"]:
                _emit_room(previous_room_code)
        _emit_room(room_payload["room_code"])
        _emit_rooms_async()

    @socketio.on("zhajinhua_leave", namespace=ROOM_NAMESPACE)
    def zhajinhua_leave(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        room_payload = zhajinhua_manager.leave_room(room_code, profile_resolver(request)["identity"])
        leave_room(room_code)
        if room_payload:
            _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_dissolve", namespace=ROOM_NAMESPACE)
    def zhajinhua_dissolve(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        snapshots = zhajinhua_manager.room_snapshots(room_code)
        try:
            zhajinhua_manager.dissolve_room(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        notified_sids = set()
        for snapshot in snapshots:
            target_sid = str(snapshot.get("sid") or "").strip()
            if not target_sid or target_sid in notified_sids:
                continue
            notified_sids.add(target_sid)
            leave_room(room_code, sid=target_sid, namespace=ROOM_NAMESPACE)
            socketio.emit(
                "zhajinhua_room_closed",
                {"room_code": room_code, "reason": "dissolved"},
                room=target_sid,
                namespace=ROOM_NAMESPACE,
            )
        _emit_rooms_async()

    @socketio.on("zhajinhua_switch_role", namespace=ROOM_NAMESPACE)
    def zhajinhua_switch_role(data):
        payload = dict(data or {})
        profile = profile_resolver(request)
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.switch_membership(
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
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_toggle_ready", namespace=ROOM_NAMESPACE)
    def zhajinhua_toggle_ready(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.toggle_ready(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_set_base_stake", namespace=ROOM_NAMESPACE)
    def zhajinhua_set_base_stake(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.set_base_stake(room_code, profile_resolver(request)["identity"], int(payload.get("base_stake") or 0))
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_update_cosmetics", namespace=ROOM_NAMESPACE)
    def zhajinhua_update_cosmetics(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.update_cosmetics(
                room_code,
                profile_resolver(request)["identity"],
                payload.get("cosmetics") if isinstance(payload.get("cosmetics"), dict) else {},
            )
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_rooms_async()

    @socketio.on("zhajinhua_start", namespace=ROOM_NAMESPACE)
    def zhajinhua_start(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.start_match(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)

    @socketio.on("zhajinhua_look", namespace=ROOM_NAMESPACE)
    def zhajinhua_look(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.look_cards(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)

    @socketio.on("zhajinhua_follow", namespace=ROOM_NAMESPACE)
    def zhajinhua_follow(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.follow_bet(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_records_async()

    @socketio.on("zhajinhua_raise", namespace=ROOM_NAMESPACE)
    def zhajinhua_raise(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.raise_bet(
                room_code,
                profile_resolver(request)["identity"],
                int(payload.get("amount") or payload.get("steps") or 0),
            )
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_records_async()

    @socketio.on("zhajinhua_compare", namespace=ROOM_NAMESPACE)
    def zhajinhua_compare(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.compare_with(
                room_code,
                profile_resolver(request)["identity"],
                str(payload.get("target_player_id") or "").strip(),
            )
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_records_async()

    @socketio.on("zhajinhua_fold", namespace=ROOM_NAMESPACE)
    def zhajinhua_fold(data):
        payload = dict(data or {})
        room_code = str(payload.get("room_code") or "").strip().upper()
        try:
            zhajinhua_manager.fold_player(room_code, profile_resolver(request)["identity"])
        except Exception as exc:
            socketio.emit("zhajinhua_error", {"error": str(exc)}, room=request.sid, namespace=ROOM_NAMESPACE)
            return
        _emit_room(room_code)
        _emit_records_async()

