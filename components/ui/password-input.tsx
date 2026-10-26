"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Поле пароля с переключателем видимости (глазик). По умолчанию пароль скрыт;
 * по клику показывается открытым текстом. `type` фиксирован внутри — снаружи
 * передаётся как обычный <Input> (value/onChange/disabled/placeholder и т.д.).
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, InputProps>(
  function PasswordInput({ className, type: _type, disabled, ...props }, ref) {
    const [show, setShow] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          className={cn("pr-10", className)}
          disabled={disabled}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
          disabled={disabled}
          aria-label={show ? "Скрыть пароль" : "Показать пароль"}
          title={show ? "Скрыть пароль" : "Показать пароль"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
