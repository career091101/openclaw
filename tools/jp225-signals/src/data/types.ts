export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeData {
  d1: Candle[];
  h4: Candle[];
  h1: Candle[];
  m15: Candle[];
  currentPrice: number;
  fetchedAt: number;
}
