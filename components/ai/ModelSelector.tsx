"use client";

import {
  isProviderEnabled,
  MODEL_ORDER,
  PROVIDER_LIST,
  PROVIDERS,
  resolveModel,
} from "@/lib/ai-models";
import type { AIModelId } from "@/lib/types";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  value: AIModelId;
  onChange: (id: AIModelId) => void;
  disabled?: boolean;
}

/**
 * Выбор модели среди всех провайдеров, сгруппированных по провайдеру. У
 * провайдера без настроенного ключа — пометка «нужен ключ».
 */
export function ModelSelector({ value, onChange, disabled }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const current = resolveModel(value);

  return (
    <Select value={value} onValueChange={(v) => onChange(v)} disabled={disabled}>
      <SelectTrigger className="h-9 w-[190px] text-xs">
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <span className="text-sm leading-none">{current.icon}</span>
            <span className="font-medium">{current.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PROVIDER_LIST.map((prov) => {
          const enabled = isProviderEnabled(prov);
          return (
            <SelectGroup key={prov}>
              <SelectLabel className="flex items-center gap-1.5">
                <span className={cn(!enabled && "text-muted-foreground")}>
                  {PROVIDERS[prov].label}
                </span>
                {!enabled ? (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    · скоро
                  </span>
                ) : (
                  !settings.providerKeys[prov] && (
                    <span className="text-[10px] font-normal text-warning">
                      · нужен ключ
                    </span>
                  )
                )}
              </SelectLabel>
              {MODEL_ORDER.filter((id) => resolveModel(id).provider === prov).map(
                (id) => {
                  const m = resolveModel(id);
                  return (
                    <SelectItem
                      key={id}
                      value={id}
                      disabled={!enabled}
                      className="text-xs"
                      title={
                        enabled
                          ? undefined
                          : "Интеграция в разработке — пока доступны модели Claude"
                      }
                    >
                      <span
                        className={cn(
                          "flex items-center gap-2",
                          !enabled && "opacity-60",
                        )}
                      >
                        <span className="text-sm leading-none">{m.icon}</span>
                        <span className="font-medium">{m.label}</span>
                        {enabled ? (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            ${m.priceInput}/${m.priceOutput}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            скоро
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                },
              )}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
