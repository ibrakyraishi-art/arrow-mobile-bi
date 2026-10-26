"use client";

import * as React from "react";
import type { ToastProps } from "./toast";

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

type ToastInput = Omit<ToasterToast, "id">;

interface ToastContextValue {
  toasts: ToasterToast[];
  toast: (t: ToastInput) => string;
  dismiss: (id?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = React.useState<ToasterToast[]>([]);

  const dismiss = React.useCallback((id?: string) => {
    setToasts((prev) => (id ? prev.filter((t) => t.id !== id) : []));
  }, []);

  const toast = React.useCallback((t: ToastInput): string => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [{ ...t, id }, ...prev].slice(0, 5));
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5500);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    return {
      toasts: [] as ToasterToast[],
      toast: () => "",
      dismiss: () => {},
    } as ToastContextValue;
  }
  return ctx;
}
