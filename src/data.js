const DATA_URL = new URL("../data/", import.meta.url);

async function getFile(filename, fetchFile) {
  const response = await fetchFile(new URL(filename, DATA_URL));
  if (!response.ok) throw new Error(`Unable to load ${filename}: HTTP ${response.status}`);
  return response;
}

export async function loadCatalog(fetchFile = fetch) {
  const catalog = await (await getFile("sessions.json", fetchFile)).json();
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error("Invalid session catalog");
  const ids = new Set();
  for (const session of catalog) {
    const { id, symbol, date, file, barCount, previousDate, previousClose, title } = session;
    if (!/^[A-Z]+$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || id !== `${symbol}-${date}` || file !== `${id}.csv` || ids.has(id)
      || !Number.isInteger(barCount) || barCount < 1 || barCount > 390
      || !/^\d{4}-\d{2}-\d{2}$/.test(previousDate) || previousDate >= date
      || !Number.isFinite(previousClose) || previousClose <= 0
      || typeof title !== "string" || !title
      || ![session.gapReturn, session.sessionReturn, session.dailyReturn,
        session.realizedVolatility].every(Number.isFinite)
      || session.realizedVolatility < 0) {
      throw new Error("Invalid session catalog entry");
    }
    ids.add(id);
  }
  return catalog;
}

// Timestamps are exchange-local America/New_York wall time, not UTC.
export function parseSessionCsv(text, session) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== "timestamp,open,high,low,close,volume") {
    throw new Error("Invalid CSV header");
  }
  let previousMinute = -1;
  const bars = lines.map((line, index) => {
    const [timestamp, ...values] = line.split(",");
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00$/.exec(timestamp);
    const numbers = values.map(value => value.trim() === "" ? NaN : Number(value));
    const [open, high, low, close, volume] = numbers;
    const minute = match ? Number(match[2]) * 60 + Number(match[3]) - 570 : -1;
    if (!match || match[1] !== session.date || Number(match[3]) > 59
      || minute < 0 || minute >= 390 || minute <= previousMinute
      || numbers.length !== 5 || !numbers.every(Number.isFinite)
      || Math.min(open, high, low, close) <= 0
      || low > Math.min(open, close) || high < Math.max(open, close) || low > high
      || !Number.isSafeInteger(volume) || volume < 0) {
      throw new Error(`Invalid bar at CSV line ${index + 2}`);
    }
    previousMinute = minute;
    return { timestamp, minute, open, high, low, close, volume };
  });
  if (bars.length !== session.barCount) throw new Error("Session bar count mismatch");
  const observed = new Set(bars.map(bar => bar.minute));
  const missingMinutes = Array.from({ length: 390 }, (_, minute) => minute)
    .filter(minute => !observed.has(minute));
  return { session, bars, missingMinutes };
}

export async function loadSession(session, fetchFile = fetch) {
  const response = await getFile(session.file, fetchFile);
  return parseSessionCsv(await response.text(), session);
}
