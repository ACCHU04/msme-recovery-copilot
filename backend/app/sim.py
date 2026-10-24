"""Simulator entry point. P3 replaces the body with the real state machine
(chat/handler.py: handle_message). The signature and return shape stay fixed so the
frontend chat page can be built now: list of reply strings, in order."""
from __future__ import annotations

from .store import Store


def handle_sim_message(store: Store, user_key: str, text: str) -> list[str]:
    convo = (store.select("conversations", user_key=user_key) or [None])[0]
    if convo is None:
        store.insert("conversations", {"user_key": user_key, "state": "START", "slots": {}})
        return ["Hi! I help you organise a delayed payment from a buyer.",
                "I can check your rights under the MSMED Act, work out what is owed, "
                "and draft follow-up messages. I never message your buyer for you.",
                "(Chat flow is being built. Type anything to test the connection.)"]
    return [f"Received: {text.strip()[:200]}"]
