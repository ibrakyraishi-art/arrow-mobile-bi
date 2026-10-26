"use client";

import { formatCurrency } from "@/lib/utils";
import { DollarSign, Info } from "lucide-react";

interface Props {
  promptTokens: number;
  outputTokens?: number;
  model?: string;
}

const PRICE_INPUT_PER_MTOK = 3; // $3 / 1M for Sonnet
const PRICE_OUTPUT_PER_MTOK = 15; // $15 / 1M for Sonnet

export function CostEstimate({
  promptTokens,
  outputTokens = 2000,
}: Props) {
  const inputCost = (promptTokens / 1_000_000) * PRICE_INPUT_PER_MTOK;
  const outputCost = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  const total = inputCost + outputCost;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
        <DollarSign className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">
            Примерная стоимость запроса
          </span>
          <span className="font-mono font-semibold text-foreground">
            ~{formatCurrency(total)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground font-mono text-[10px]">
          <span>Input: {promptTokens.toLocaleString("ru-RU")} tok</span>
          <span>·</span>
          <span>Output: ~{outputTokens.toLocaleString("ru-RU")} tok</span>
          <span>·</span>
          <span>claude-sonnet-4</span>
        </div>
      </div>
      <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
    </div>
  );
}

export function estimateTokens(text: string): number {
  // Rough approximation: ~4 chars per token for English, ~2-3 for Russian.
  // Use 3.5 as a middle-ground estimate.
  return Math.ceil(text.length / 3.5);
}
