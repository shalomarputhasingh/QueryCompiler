import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-muted-foreground",
      primary: "border-primary/30 bg-primary/15 text-accent-foreground",
      success: "border-success/30 bg-success/15 text-success",
      warning: "border-warning/30 bg-warning/15 text-warning",
      danger: "border-destructive/30 bg-destructive/15 text-destructive",
      info: "border-info/30 bg-info/15 text-info",
      violet: "border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300",
      blue: "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300",
      amber: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
      green: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      pink: "border-pink-500/30 bg-pink-500/15 text-pink-700 dark:text-pink-300",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
