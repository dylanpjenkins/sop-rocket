import type React from "react";
import { Input } from "@/components/ui/input";
import { cn, getContrastTextColor } from "@/lib/utils";

interface StepHeaderProps {
  index: number;
  title: string;
  editable?: boolean;
  onTitleChange?: (value: string) => void;
  onEnterKey?: () => void;
  accentColor?: string;
  /** When set, step number circle uses this background and auto contrast text */
  stepNumberIconBgColor?: string;
  className?: string;
  titlePlaceholder?: string;
  fallbackLabel?: string;
  /** Custom display label for the step number badge (e.g., "1a" for sub-steps) */
  displayLabel?: string;
}

export function StepHeader({
  index,
  title,
  editable = false,
  onTitleChange,
  onEnterKey,
  accentColor,
  stepNumberIconBgColor,
  className,
  titlePlaceholder = "Description (optional)",
  fallbackLabel,
  displayLabel,
}: StepHeaderProps) {
  const stepLabel = fallbackLabel ?? `Step ${displayLabel ?? index + 1}`;
  const rootClassName = cn("min-w-0 flex-1", className);
  const bgColor = stepNumberIconBgColor ?? undefined;
  const textColor = bgColor ? getContrastTextColor(bgColor) : undefined;

  return (
    <div className={rootClassName}>
      <div className="flex items-start">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold leading-none border border-border shadow-sm"
          style={
            bgColor
              ? { backgroundColor: bgColor, color: textColor }
              : { backgroundColor: "var(--background)", color: "var(--foreground)" }
          }
          aria-hidden>
          <span className="block">{displayLabel ?? index + 1}</span>
        </span>
      </div>
      <div className="min-w-0 flex-1 mt-2">
        {editable && onTitleChange ? (
          <Input
            placeholder={titlePlaceholder}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && onEnterKey) {
                e.preventDefault();
                onEnterKey();
              }
            }}
            className="flex-1 h-8 min-h-0 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base font-medium leading-snug placeholder:text-muted-foreground py-0"
          />
        ) : title ? (
          <span
            className="block text-base font-semibold leading-snug truncate"
            style={accentColor ? { color: accentColor } : undefined}>
            {title}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{stepLabel}</span>
        )}
      </div>
    </div>
  );
}

