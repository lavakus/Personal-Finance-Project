# Connecting a trading bot to TradeOS

TradeOS ingests bot activity over an HMAC-signed HTTP API (brief §64). Any bot
in any language can report to it; the reference implementation is the MT5
Gold/BTC bot at `C:\Users\ITS48\Desktop\Gold` (`tradeos_sink.py`).

## The contract

Three endpoints, all `POST`, all authenticated the same way:

| Endpoint | Purpose |
|---|---|
| `/api/bots/trades` | Trade opened / closed. Upserted by `(bot, externalId)`, so a bot can safely retry and the close updates the same row rather than creating a second one. |
| `/api/bots/equity` | Equity snapshot. Powers the equity curve and drawdown. |
| `/api/bots/heartbeat` | Liveness. `status: "ERROR"` also raises a notification. |

### Authentication

Every request carries three headers:

```
x-api-key    tbk_...                       the key issued at bot registration
x-timestamp  1786286568409                 unix milliseconds
x-signature  <hex>                         HMAC-SHA256(key, "{timestamp}.{body}")
```

The signature covers the **exact bytes posted**, so serialise the body once and
sign that string — re-encoding (different key order, different whitespace)
changes the hash and the request is rejected.

```python
body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
ts   = str(int(time.time() * 1000))
sig  = hmac.new(key.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
requests.post(url, data=body.encode(), headers={...})   # post the same bytes
```

Server-side guarantees: keys are stored as SHA-256 hashes (a database leak
cannot forge requests), signatures are compared in constant time, timestamps
outside a 5-minute window are rejected (replay protection), and each key is
rate-limited to 60 requests/minute.

### Payloads

```jsonc
// POST /api/bots/trades  — open
{"externalId": "12345", "symbol": "GOLD", "direction": "LONG", "status": "OPEN",
 "entryPrice": 3400.5, "quantity": 0.01, "fees": 0,
 "openedAt": "2026-08-09T14:52:00+00:00", "raw": {"setup": "..."}}

// POST /api/bots/trades  — close (same externalId; replaces the row)
{"externalId": "12345", ..., "status": "CLOSED", "exitPrice": 3412.0,
 "pnl": 11.5, "closedAt": "2026-08-09T15:20:00+00:00",
 "raw": {"r_multiple": 1.15, "exit_reason": "target"}}

// POST /api/bots/equity
{"equity": 2500.0}                    // "asOf" optional, defaults to now

// POST /api/bots/heartbeat
{"status": "OK"}                      // or {"status": "ERROR", "message": "..."}
```

`direction` is `LONG`/`SHORT` (map from BUY/SELL). `pnl` is what the Bots page
uses for win rate, profit factor and expectancy — those are computed from
ingested closed trades, never from a summary the bot reports about itself.

## Registering a bot

In the app: **Bots → Register bot**. The API key is displayed **once** and only
its hash is stored — copy it immediately. A lost key can't be recovered; issue a
new one and revoke the old.

## Reference implementation notes

`tradeos_sink.py` subclasses the bot's existing `Notifier`, so wiring it up is a
single line (`Notifier(cfg)` → `TradeOSNotifier(cfg)`) and every event the bot
already announces to Telegram is mirrored to TradeOS.

Two properties matter more than the feature itself, and any bot integration
should preserve them:

- **Reporting must never be a dependency of execution.** The MT5 loop ticks
  once a second; a slow or failed HTTP call must not stall trade management. All
  posts go through a bounded queue on a background daemon thread, and every
  failure path ends in a log line rather than an exception.
- **Telegram must not depend on TradeOS.** Each override calls `super()` first,
  so a TradeOS outage can never suppress a trade alert. (The bot now runs with
  Telegram disabled — `[telegram] enabled = false` — and the inherited method
  writes an `[alert]` line to the local log instead, which stays useful as an
  on-disk audit trail. Re-enabling is one config flag.)
- **Drain the queue on shutdown.** A session's *last* events — the final exit
  and closing equity — are enqueued moments before the bot exits, so tearing
  the sender down immediately loses exactly the records that close out the
  day's P&L. `close()` waits for the queue to empty and for the in-flight
  request to return, bounded so a wedged endpoint still can't hang the exit.
  This was caught in testing: the trade sat in TradeOS as `OPEN` forever
  because the `CLOSED` post was discarded at shutdown.

Configuration is environment-only, so nothing in `config.ini` needs to change
and the bot behaves exactly as before when the variables are absent:

```
TRADEOS_URL              https://<your-deployment>.vercel.app
TRADEOS_BOT_KEY_GOLD     tbk_...
TRADEOS_BOT_KEY_BTCUSD   tbk_...
TRADEOS_BOT_KEY          tbk_...   # fallback when only one bot runs
```

**One key per bot, not per install.** Two instruments running side by side
from the same code are two bots; sharing a key would merge two strategies into
a single equity curve and make win rate and profit factor meaningless. The
sink resolves `TRADEOS_BOT_KEY_<SYMBOL>` first and falls back to the shared
name.

**Paper/dry-run modes must not report trades.** A bot evaluating signals
without placing orders has no ticket, fill price or position to report, and
writing hypothetical fills into `bot_trades` would mix them into the same win
rate as real ones. Heartbeats and equity still flow, so the bot shows as
online — only trades are withheld. Live, paper and backtest results stay
separate (brief rule 13).

The sink also emits its own heartbeat every 15 minutes from the background
thread, so a quiet session is distinguishable from a dead bot without the
trading loop having to know the sink exists.
