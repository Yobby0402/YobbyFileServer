from __future__ import annotations

from yobboy_file_server.game_zhajinhua import (
    ZhajinhuaManager,
    compare_zhajinhua_hands,
    evaluate_zhajinhua_hand,
)
import pytest


class FakeStore:
    def __init__(self) -> None:
        self.rooms = {}
        self.scores = {}
        self.records = []

    def list_room_states(self, room_type: str):
        return []

    def save_room_state(self, room_type: str, room_code: str, state):
        self.rooms[(room_type, room_code)] = state
        return {"room_type": room_type, "room_code": room_code, "state": state, "updated_at": "now"}

    def delete_room_state(self, room_type: str, room_code: str):
        self.rooms.pop((room_type, room_code), None)

    def total_score_summary(self, ip: str):
        return {"total_score": self.scores.get(ip, 1000), "play_count": 0}

    def total_score_summaries(self, ips):
        return {
            ip: {"total_score": self.scores.get(ip, 1000), "play_count": 0}
            for ip in ips or []
        }

    def record_score(self, ip: str, game_id: str, score, mode: str = "", session_key: str = "", meta=None):
        self.scores[ip] = self.total_score_summary(ip)["total_score"] + int(score or 0)
        payload = {
            "ip": ip,
            "game_id": game_id,
            "score": int(score or 0),
            "mode": mode,
            "session_key": session_key,
            "meta": meta or {},
        }
        self.records.append(payload)
        return payload

    def record_room_record(self, room_type: str, room_code: str, record):
        self.records.append({"room_type": room_type, "room_code": room_code, "record": record})
        return record


def _cards(*cards):
    return [{"rank": rank, "suit": suit} for rank, suit in cards]


def test_hand_compare_ranking():
    assert compare_zhajinhua_hands(
        _cards((14, "spades"), (14, "hearts"), (14, "clubs")),
        _cards((13, "spades"), (13, "hearts"), (13, "clubs")),
    ) > 0
    assert evaluate_zhajinhua_hand(_cards((14, "spades"), (13, "spades"), (12, "spades")))["kind_key"] == "straight_flush"
    assert evaluate_zhajinhua_hand(_cards((10, "hearts"), (10, "clubs"), (5, "diamonds")))["kind_key"] == "pair"


def test_a23_is_low_straight_by_default():
    hand = evaluate_zhajinhua_hand(_cards((14, "spades"), (3, "hearts"), (2, "clubs")))
    assert hand["kind_key"] == "straight"
    assert compare_zhajinhua_hands(
        _cards((14, "spades"), (3, "hearts"), (2, "clubs")),
        _cards((4, "spades"), (3, "diamonds"), (2, "hearts")),
    ) < 0


def test_raise_uses_selected_amount_and_compare_cost_uses_double_current_bet():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room = manager._rooms[room_code]
    assert all(not player["is_seen"] for player in live_room["players"])
    first_turn = live_room["turn_player_id"]
    manager.raise_bet(room_code, first_turn, 20)

    assert live_room["current_bet"] == 20
    raiser = manager._find_player(live_room, first_turn)
    assert raiser["total_bet"] == 30

    next_player = live_room["turn_player_id"]
    compare_target = "player-1" if next_player == "player-2" else "player-2"
    manager.compare_with(room_code, next_player, compare_target)

    comparer = manager._find_player(live_room, next_player)
    assert comparer["total_bet"] == 50


def test_look_cards_reveals_only_after_choice():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room = manager._rooms[room_code]
    current = live_room["turn_player_id"]
    manager.look_cards(room_code, current)

    current_player = manager._find_player(live_room, current)
    other_player_id = "player-1" if current == "player-2" else "player-2"
    other_player = manager._find_player(live_room, other_player_id)
    assert current_player["is_seen"] is True
    assert other_player["is_seen"] is False


def test_public_room_hides_self_cards_before_look():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    payload = manager._public_room(manager._rooms[room_code], "player-1")
    me = next(item for item in payload["players"] if item["player_id"] == "player-1")
    assert "cards" not in me
    assert me["hand_kind_label"] == ""


def test_host_can_manually_start_next_match_after_finish_without_readying_again():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room = manager._rooms[room_code]
    manager.fold_player(room_code, live_room["turn_player_id"])
    assert live_room["status"] == "finished"
    assert all(not player["is_ready"] for player in live_room["players"])

    manager.start_match(room_code, "player-1")
    assert live_room["status"] == "playing"
    assert live_room["round_count"] == 1


def test_player_can_raise_with_negative_score_during_hand_but_cannot_start_next_hand_while_negative():
    store = FakeStore()
    store.scores["player-2"] = 5
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room = manager._rooms[room_code]
    assert store.scores["player-2"] == -5

    manager.raise_bet(room_code, live_room["turn_player_id"], 20)
    assert store.scores["player-2"] == -25

    manager.follow_bet(room_code, live_room["turn_player_id"])
    manager.fold_player(room_code, live_room["turn_player_id"])
    assert live_room["status"] == "finished"
    assert store.scores["player-2"] < 0

    with pytest.raises(ValueError):
        manager.start_match(room_code, "player-1")


def test_negative_score_player_cannot_join_table():
    store = FakeStore()
    store.scores["player-1"] = -1
    manager = ZhajinhuaManager(store=store)

    spectator_room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice", spectate=True)
    room_code = spectator_room["room_code"]

    with pytest.raises(ValueError):
        manager.switch_membership(room_code, "ip-1", "player-1", "sid-1", "Alice", spectate=False)


def test_reach_max_round_triggers_showdown():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    live_room = manager._rooms[room_code]
    live_room["max_round"] = 1
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room["players"][0]["cards"] = _cards((14, "spades"), (14, "hearts"), (14, "clubs"))
    live_room["players"][1]["cards"] = _cards((2, "diamonds"), (5, "clubs"), (7, "hearts"))

    manager.follow_bet(room_code, live_room["turn_player_id"])

    assert live_room["status"] == "finished"
    assert live_room["winner_player_id"] == "player-1"


def test_compare_reveals_both_hands_to_room_payload():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")
    live_room = manager._rooms[room_code]
    live_room["players"][0]["cards"] = _cards((14, "spades"), (14, "hearts"), (14, "clubs"))
    live_room["players"][1]["cards"] = _cards((2, "diamonds"), (5, "clubs"), (7, "hearts"))
    live_room["players"][0]["is_seen"] = True
    live_room["players"][1]["is_seen"] = True

    manager.compare_with(room_code, live_room["turn_player_id"], "player-1")
    payload = manager._public_room(live_room, "player-1")
    revealed = [item for item in payload["players"] if item.get("cards")]
    assert len(revealed) == 2


def test_round_settlement_awards_winner():
    store = FakeStore()
    manager = ZhajinhuaManager(store=store)
    room = manager.create_or_join_room("ip-1", "player-1", "sid-1", "Alice")
    room_code = room["room_code"]
    manager.create_or_join_room("ip-2", "player-2", "sid-2", "Bob", room_code=room_code)
    manager.set_base_stake(room_code, "player-1", 10)
    manager.toggle_ready(room_code, "player-1")
    manager.toggle_ready(room_code, "player-2")
    manager.start_match(room_code, "player-1")

    live_room = manager._rooms[room_code]
    live_room["players"][0]["cards"] = _cards((14, "spades"), (14, "hearts"), (14, "clubs"))
    live_room["players"][0]["hand_compare"] = list(evaluate_zhajinhua_hand(live_room["players"][0]["cards"])["compare"])
    live_room["players"][0]["hand_kind_label"] = "豹子"
    live_room["players"][1]["cards"] = _cards((2, "diamonds"), (5, "clubs"), (7, "hearts"))
    live_room["players"][1]["hand_compare"] = list(evaluate_zhajinhua_hand(live_room["players"][1]["cards"])["compare"])
    live_room["players"][1]["hand_kind_label"] = "单张"
    live_room["turn_player_id"] = "player-2"

    manager.fold_player(room_code, "player-2")

    assert live_room["status"] == "finished"
    assert live_room["winner_player_id"] == "player-1"
    assert store.scores["player-1"] == 1010
    assert store.scores["player-2"] == 990
