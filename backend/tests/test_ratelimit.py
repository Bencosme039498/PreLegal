from app.ratelimit import RateLimiter, retry_after_header
from tests.conftest import FakeClock


def test_sliding_window() -> None:
    clock = FakeClock(0)
    limiter = RateLimiter(2, 10, clock)
    assert limiter.hit("a") is None
    clock.advance(4)
    assert limiter.hit("a") is None
    assert limiter.blocked("a") == 6  # the first event leaves the window at t=10
    assert limiter.hit("a") == 6  # refused, and not recorded
    clock.advance(6)
    assert limiter.blocked("a") is None
    assert limiter.hit("a") is None
    assert limiter.hit("a") == 4  # the event at t=4 leaves at t=14


def test_keys_are_independent_and_reset() -> None:
    limiter = RateLimiter(1, 60, FakeClock())
    assert limiter.hit("a") is None
    assert limiter.hit("b") is None
    assert limiter.hit("a") is not None
    limiter.reset("a")
    assert limiter.hit("a") is None


def test_blocked_records_nothing() -> None:
    limiter = RateLimiter(1, 60, FakeClock())
    for _ in range(3):
        assert limiter.blocked("a") is None
    assert limiter.hit("a") is None


def test_retry_after_header_rounds_up_to_whole_seconds() -> None:
    assert retry_after_header(0.2) == {"Retry-After": "1"}
    assert retry_after_header(0) == {"Retry-After": "1"}
    assert retry_after_header(59.1) == {"Retry-After": "60"}
