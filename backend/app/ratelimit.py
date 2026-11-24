"""In-memory sliding-window rate limits (one process; counters reset with the app, like the database)."""

import math
import threading
from collections import deque
from collections.abc import Callable

# Bounds memory under many distinct keys (e.g. random emails): the earliest-added keys are dropped first.
_MAX_KEYS = 10_000


class RateLimiter:
    """At most `limit` events per key within any `window_s` seconds.

    Thread-safe: sync FastAPI endpoints run in a threadpool.
    """

    def __init__(self, limit: int, window_s: float, clock: Callable[[], float]) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        events = self._events.get(key)
        if events is None:
            return deque()
        while events and events[0] <= now - self.window_s:
            events.popleft()
        if not events:
            del self._events[key]
        return events

    def _retry_after(self, events: deque[float], now: float) -> float | None:
        if len(events) < self.limit:
            return None
        return max(events[0] + self.window_s - now, 0.0)

    def blocked(self, key: str) -> float | None:
        """Seconds until `key` may act again, or None if it is under the limit (records nothing)."""
        with self._lock:
            now = self._clock()
            return self._retry_after(self._recent(key, now), now)

    def hit(self, key: str) -> float | None:
        """Records an event for `key` unless it is over the limit; returns the seconds to wait if so."""
        with self._lock:
            now = self._clock()
            events = self._recent(key, now)
            retry = self._retry_after(events, now)
            if retry is not None:
                return retry
            if key not in self._events:
                if len(self._events) >= _MAX_KEYS:
                    del self._events[next(iter(self._events))]
                self._events[key] = events
            events.append(now)
            return None

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


def retry_after_header(seconds: float) -> dict[str, str]:
    return {"Retry-After": str(max(1, math.ceil(seconds)))}
