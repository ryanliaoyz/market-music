"""Slice downloaded HF Clean CSVs; run from the repository root."""

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


SESSIONS = {
    "SPY": {
        "2022-09-13": "Hot CPI selloff",
        "2023-12-26": "Calm control",
        "2024-08-05": "Global selloff",
        "2025-01-27": "DeepSeek shock",
        "2025-04-03": "Tariff crash, day one",
        "2025-04-04": "Tariff crash, day two",
        "2025-04-09": "Tariff pause rally",
    },
    "NVDA": {"2025-01-27": "DeepSeek shock"},
}


def realized_volatility(rows):
    closes = [float(row["Close"]) for row in rows]
    return math.sqrt(sum(math.log(b / a) ** 2 for a, b in zip(closes, closes[1:])))


def read_days(path):
    days = defaultdict(list)
    with path.open(newline="") as file:
        for row in csv.DictReader(file):
            date, time = row["datetime"].split(" ")
            # The two 2023 half-days must not include post-close prints.
            end = "13:00:00" if date in ("2023-07-03", "2023-11-24") else "16:00:00"
            if "09:30:00" <= time < end:
                days[date].append(row)
    return days


def main():
    source_dir = Path(sys.argv[1])
    output = Path("data")
    output.mkdir(exist_ok=True)
    catalog = []
    for symbol, sessions in SESSIONS.items():
        days = read_days(source_dir / f"{symbol}_clean.csv")
        dates = sorted(days)
        if symbol == "SPY":
            candidates = {date: realized_volatility(rows) for date, rows in days.items()
                          if date.startswith("2023") and date not in ("2023-07-03", "2023-11-24")}
            assert len(candidates) == 248
            assert min(candidates, key=candidates.get) == "2023-12-26"
        for date, title in sessions.items():
            rows = days[date]
            previous_date = dates[dates.index(date) - 1]
            previous_close = float(days[previous_date][-1]["Close"])
            opening = float(rows[0]["Open"])
            closing = float(rows[-1]["Close"])
            filename = f"{symbol}-{date}.csv"
            with (output / filename).open("w", newline="") as file:
                writer = csv.writer(file, lineterminator="\n")
                writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
                for row in rows:
                    writer.writerow([row["datetime"].replace(" ", "T"),
                                     *(row[column] for column in ("Open", "High", "Low", "Close", "Volume"))])
            catalog.append({
                "id": f"{symbol}-{date}", "symbol": symbol, "date": date, "title": title,
                "file": filename, "barCount": len(rows),
                "previousDate": previous_date, "previousClose": previous_close,
                "gapReturn": opening / previous_close - 1,
                "sessionReturn": closing / opening - 1,
                "dailyReturn": closing / previous_close - 1,
                "realizedVolatility": realized_volatility(rows),
            })
    (output / "sessions.json").write_text(json.dumps(catalog, indent=2) + "\n")


if __name__ == "__main__":
    main()
