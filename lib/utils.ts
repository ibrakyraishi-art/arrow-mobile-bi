import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { noNegativeZero } from "./format-value";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(noNegativeZero(n, digits));
}

export function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return total;
    return total + value;
  }, 0);
}

export function divide(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (typeof numerator !== "number" || Number.isNaN(numerator)) return null;
  if (typeof denominator !== "number" || Number.isNaN(denominator)) return null;
  if (denominator === 0) return null;

  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function maskHost(host: string): string {
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length < 2) return host.slice(0, 3) + "•••";
  parts[0] = parts[0].slice(0, 2) + "•••";
  return parts.join(".");
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 8) + "•".repeat(10) + key.slice(-4);
}
