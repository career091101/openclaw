import type { Config } from "../config.js";
import type { Candle } from "./types.js";

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: { regularMarketPrice: number };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }>;
    error: { code: string; description: string } | null;
  };
}

async function fetchWithRetry(url: string, config: Config): Promise<Response> {
  const { retries, timeoutMs } = config.yahoo;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      clearTimeout(timer);

      if (res.ok) {
        return res;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
      }
      throw new Error(`Yahoo API ${res.status}: ${res.statusText}`);
    } catch (err: any) {
      if (attempt < retries && (err.name === "AbortError" || err.code === "ECONNRESET")) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Yahoo API: max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCandles(data: YahooChartResponse): Candle[] {
  const result = data.chart.result?.[0];
  if (!result || !result.timestamp) {
    return [];
  }

  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  const candles: Candle[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    // Skip null values (market gaps)
    if (quote.open[i] == null || quote.close[i] == null) {
      continue;
    }
    candles.push({
      timestamp: timestamp[i] * 1000, // to ms
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i] ?? 0,
    });
  }

  return candles;
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  range: string,
  config: Config,
): Promise<Candle[]> {
  const encoded = encodeURIComponent(symbol);
  const url = `${config.yahoo.baseUrl}/${encoded}?interval=${interval}&range=${range}`;
  const res = await fetchWithRetry(url, config);
  const data: YahooChartResponse = await res.json();

  if (data.chart.error) {
    throw new Error(`Yahoo API error: ${data.chart.error.description}`);
  }

  return parseCandles(data);
}

export async function fetchCurrentPrice(symbol: string, config: Config): Promise<number> {
  const encoded = encodeURIComponent(symbol);
  const url = `${config.yahoo.baseUrl}/${encoded}?interval=1m&range=1d`;
  const res = await fetchWithRetry(url, config);
  const data: YahooChartResponse = await res.json();
  return data.chart.result?.[0]?.meta?.regularMarketPrice ?? 0;
}

export interface MultiTimeframeRaw {
  d1: Candle[];
  h1_monthly: Candle[]; // for H4 aggregation
  h1_weekly: Candle[]; // for ATR
  m15: Candle[];
  currentPrice: number;
}

export async function fetchAllTimeframes(config: Config): Promise<MultiTimeframeRaw> {
  const symbol = config.symbol;
  const [d1, h1_monthly, h1_weekly, m15, price] = await Promise.all([
    fetchCandles(symbol, "1d", "3mo", config),
    fetchCandles(symbol, "1h", "1mo", config),
    fetchCandles(symbol, "1h", "5d", config),
    fetchCandles(symbol, "15m", "5d", config),
    fetchCurrentPrice(symbol, config),
  ]);

  return { d1, h1_monthly, h1_weekly, m15, currentPrice: price };
}
