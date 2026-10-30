// Input is a validated loadSession/parseSessionCsv result; calculations are pure.
export function computeFeatures(loadedSession) {
  const { session, bars } = loadedSession;
  const returns = bars.map((bar, index) => {
    const previous = bars[index - 1];
    return previous && bar.minute === previous.minute + 1
      ? bar.close / previous.close - 1
      : null;
  });
  const samples = returns.filter(value => value !== null);
  const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
  const sigma = samples.length
    ? Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length)
    : null;
  const eventThreshold = sigma === null ? null : 3 * sigma;
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  const features = bars.map((bar, index) => {
    const barReturn = returns[index];
    const windowReturns = [];
    for (let i = index; i >= 0 && bars[i].minute > bar.minute - 5; i--) {
      if (returns[i] !== null) windowReturns.push(returns[i]);
    }
    cumulativeVolume += bar.volume;
    cumulativePriceVolume += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    return {
      ...bar,
      return: barReturn,
      rollingVolatility: windowReturns.length
        ? Math.sqrt(windowReturns.reduce((sum, value) => sum + value ** 2, 0))
        : null,
      rollingReturnCount: windowReturns.length,
      vwap: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null,
      event: barReturn !== null && Math.abs(barReturn) > eventThreshold
        ? (barReturn < 0 ? "drop" : "spike")
        : null,
    };
  });
  return {
    ...loadedSession,
    bars: features,
    returnCount: samples.length,
    sigma,
    eventThreshold,
    openingGapReturn: bars[0].minute === 0 ? bars[0].open / session.previousClose - 1 : null,
  };
}
