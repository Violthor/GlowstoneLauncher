import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// 轻量自研 Checkbox（不依赖额外的 radix 组件）：受控，支持 onCheckedChange(v:boolean)
export interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked = false, onCheckedChange, id, className, disabled }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      id={id}
      disabled={disabled}
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "size-4 shrink-0 rounded-[4px] border flex items-center justify-center transition-colors",
        checked ? "bg-primary border-primary text-primary-foreground" : "bg-background border-input hover:border-primary",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  ),
);
Checkbox.displayName = "Checkbox";
