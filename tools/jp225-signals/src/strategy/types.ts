export type TrendDirection = "BUY" | "SELL" | "FLAT";

export interface TrendResult {
  direction: TrendDirection;
  ema21: number;
  ema55: number;
  adx: number;
}

export interface SignalConfirmation {
  confirmed: boolean;
  rsiValue: number;
  rsiCrossed: boolean;
  macdHistReversed: boolean;
}

export interface EntryTrigger {
  triggered: boolean;
  stochK: number;
  stochD: number;
}

export interface RiskLevels {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  atrValue: number;
  riskRewardRatio: number;
}

export interface Signal {
  id: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  atrValue: number;
  score: number;
  createdAt: number;
  status: "active" | "tp1_hit" | "tp2_hit" | "sl_hit" | "expired";
  positionSize?: number;
  tp1Hit: boolean;
  details: {
    d1: TrendResult;
    h4: SignalConfirmation;
    m15: EntryTrigger;
  };
}

export interface DailyStats {
  date: string;
  wins: number;
  losses: number;
  expired: number;
  consecutiveLosses: number;
  pnlPoints: number;
}

export interface SignalState {
  activeSignals: Signal[];
  history: Signal[];
  dailyStats: DailyStats[];
  lastAnalysisAt: number;
  lastSignalAt: number;
  lastLossAt: number;
}
