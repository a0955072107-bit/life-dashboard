"""抓取美股、指數、黃金、匯率報價（Yahoo Finance chart API）→ data/markets.json"""
import sys
import time

import requests

from common import CONFIG, UA, now_iso, read_json, write_json

HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]


def fetch(symbol: str) -> dict:
    last_err = None
    for host in HOSTS:
        try:
            r = requests.get(
                f"{host}/v8/finance/chart/{requests.utils.quote(symbol)}",
                params={"range": "1mo", "interval": "1d"},
                headers={"User-Agent": UA},
                timeout=20,
            )
            r.raise_for_status()
            res = r.json()["chart"]["result"][0]
            meta = res["meta"]
            closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
            price = meta.get("regularMarketPrice") or closes[-1]
            # closes[-1] 是最新一個交易日（盤中即時價），前一日收盤是 closes[-2]
            prev = closes[-2] if len(closes) >= 2 else meta.get("chartPreviousClose")
            change = price - prev if prev else None
            return {
                "price": round(price, 4),
                "prevClose": round(prev, 4) if prev else None,
                "change": round(change, 4) if change is not None else None,
                "changePct": round(change / prev * 100, 3) if prev else None,
                "monthPct": round((price / closes[0] - 1) * 100, 3) if closes else None,
                "currency": meta.get("currency"),
                "marketTime": meta.get("regularMarketTime"),
                "history": [round(c, 4) for c in closes],
            }
        except Exception as e:  # noqa: BLE001 - try the next host
            last_err = e
            time.sleep(1)
    raise RuntimeError(f"{symbol}: {last_err}")


def main() -> int:
    old = {q["symbol"]: q for q in (read_json("markets.json", {}) or {}).get("quotes", [])}
    quotes, failed = [], []
    for m in CONFIG["markets"]:
        try:
            quotes.append({**m, **fetch(m["symbol"])})
        except Exception as e:  # noqa: BLE001
            print("WARN", e, file=sys.stderr)
            failed.append(m["symbol"])
            if m["symbol"] in old:  # 保留上一次的資料
                quotes.append({**old[m["symbol"]], "stale": True})
    if not quotes:
        print("no quotes fetched", file=sys.stderr)
        return 1
    write_json("markets.json", {"updated": now_iso(), "quotes": quotes, "failed": failed})
    print(f"markets: {len(quotes)} ok, {len(failed)} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
