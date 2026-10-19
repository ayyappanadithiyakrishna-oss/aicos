/**
 * Live event-reaction model, trained offline on real history by scripts/train-live-model.mts
 * (Massive news × London Strategic Edge prices) and committed as model.json.
 */
import type { EventReactionModel } from "@/lib/quant/model";
import data from "./model.json";

export const LIVE_MODEL = data.model as unknown as EventReactionModel;
export const LIVE_MODEL_TRAINING = data.training as { articles: number; tickersQueried: number; pricedTickers: number; examples: number; firstAt: string | null; lastAt: string; bySubtype: Record<string, number> };
