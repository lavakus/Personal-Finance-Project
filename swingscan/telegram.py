"""Telegram alerts for the swing scanner.

Separate from the MT5 bots' notifier on purpose: this runs inside GitHub Actions,
where the token lives in repository Secrets rather than on anyone's machine. That
also sidesteps the office firewall, which blocks api.telegram.org from the trading
PC but obviously not from GitHub's runners.

Configuration is environment-only, so nothing secret ever reaches a config file:
    TG_TOKEN   bot token from @BotFather
    TG_CHAT    chat id
Falls back to the MT5 bots' XM_TG_TOKEN / XM_TG_CHAT so one pair of credentials can
serve both systems. Silently does nothing when unset - a missing token must never
break a scan or a publish.
"""
from __future__ import annotations

import html
import logging
import os

import requests

log = logging.getLogger(__name__)

API = "https://api.telegram.org/bot{token}/sendMessage"
TIMEOUT_S = 10
# Telegram hard-limits a message to 4096 chars.
LIMIT = 4000


def _creds() -> tuple[str, str]:
    tok = (os.environ.get("TG_TOKEN") or os.environ.get("XM_TG_TOKEN") or "").strip()
    chat = (os.environ.get("TG_CHAT") or os.environ.get("XM_TG_CHAT") or "").strip()
    return tok, chat


def enabled() -> bool:
    tok, chat = _creds()
    return bool(tok and chat)


def send(text: str) -> bool:
    """Post one HTML message. Never raises - alerting must not break the pipeline."""
    tok, chat = _creds()
    if not (tok and chat):
        log.info("telegram not configured (TG_TOKEN / TG_CHAT unset), skipping alert")
        return False
    if len(text) > LIMIT:
        text = text[:LIMIT] + "\n…(truncated)"
    try:
        r = requests.post(
            API.format(token=tok),
            json={"chat_id": chat, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=TIMEOUT_S,
        )
        if r.status_code >= 300:
            log.warning("telegram send failed %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as exc:                      # network, DNS, TLS - all non-fatal
        log.warning("telegram send failed: %s", exc)
        return False


def _esc(s) -> str:
    return html.escape(str(s), quote=False)


def scan_alert(res, top: int = 5) -> str:
    """The daily scan: regime, then each new candidate with its actual trade plan."""
    d = res.as_of.date() if hasattr(res.as_of, "date") else res.as_of
    reg = getattr(res.regime, "label", "?")
    score = getattr(res.regime, "score", None)
    head = f"<b>📊 NSE swing scan — {_esc(d)}</b>\nRegime: <b>{_esc(reg)}</b>"
    if score is not None:
        head += f" ({score:+.1f})"

    if res.no_trade or not res.candidates:
        why = res.no_trade_reason or "no candidate cleared the filters"
        near = ""
        if res.near_misses:
            names = ", ".join(_esc(s) for s, _ in res.near_misses[:5])
            near = f"\nWatchlist: {names}"
        return f"{head}\n\n<b>NO TRADE today.</b>\n{_esc(why)}{near}"

    lines = [head, f"\n<b>{len(res.candidates)} new setup(s):</b>"]
    for c in res.candidates[:top]:
        rp, s = c.risk_plan, c.setup
        lines.append(
            f"\n<b>{_esc(c.symbol)}</b>  {_esc(s.setup_type)}  "
            f"score <b>{c.score.total:.0f}</b> ({_esc(c.score.tier)})"
            f"\n  Entry ₹{s.entry_low:,.2f}–₹{s.entry_high:,.2f}"
            f"\n  Stop ₹{rp.stop:,.2f}   T1 ₹{rp.t1:,.2f}   T2 ₹{rp.t2:,.2f}"
            f"\n  R:R {rp.rr1:.1f} / {rp.rr2:.1f}   "
            f"{c.sizing.shares} sh (₹{c.sizing.notional:,.0f})"
        )
        if c.why:
            lines.append(f"  <i>{_esc(c.why[0])}</i>")
        if c.warnings:
            lines.append(f"  ⚠️ {_esc(c.warnings[0])}")
    if len(res.candidates) > top:
        lines.append(f"\n…and {len(res.candidates) - top} more.")
    lines.append("\n<i>Analysis only — never auto-executed.</i>")
    return "\n".join(lines)


def paper_alert(opened: list[dict], closed: list[dict], equity: float,
                start_equity: float) -> str | None:
    """Paper-book activity. Returns None when nothing happened, so we stay quiet."""
    if not opened and not closed:
        return None
    ret = 100.0 * (equity / start_equity - 1.0) if start_equity else 0.0
    out = [f"<b>📒 Paper book</b>  ₹{equity:,.0f} ({ret:+.2f}%)"]
    for t in opened:
        out.append(
            f"\n🟢 <b>OPEN {_esc(t.get('symbol'))}</b> {_esc(t.get('setup_type', ''))}"
            f"\n  {t.get('shares')} sh @ ₹{float(t.get('entry_price', 0)):,.2f}"
            f"   stop ₹{float(t.get('stop', 0)):,.2f}"
        )
    for t in closed:
        pnl = float(t.get("net_pnl") or 0)
        r = t.get("r_multiple")
        icon = "✅" if pnl > 0 else "❌"
        rtxt = f"  {float(r):+.2f}R" if r is not None else ""
        out.append(
            f"\n{icon} <b>CLOSE {_esc(t.get('symbol'))}</b> — {_esc(t.get('exit_reason', ''))}"
            f"\n  ₹{pnl:+,.0f}{rtxt}   held {t.get('holding_days', '?')}d"
        )
    return "\n".join(out)
