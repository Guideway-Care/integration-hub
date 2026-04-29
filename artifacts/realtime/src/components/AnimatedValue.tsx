import { useState, useEffect, useRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedValueProps {
  value: string | number;
  className?: string;
}

export function AnimatedValue({ value, className }: AnimatedValueProps) {
  const prevValue = useRef(value);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    if (prevValue.current === value) return;
    setIsFlashing(true);
    const timer = setTimeout(() => setIsFlashing(false), 1000);
    prevValue.current = value;
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span
      className={cn(
        "transition-colors duration-1000 px-1 -mx-1 rounded",
        isFlashing ? "bg-primary/30 text-primary-foreground" : "bg-transparent",
        className
      )}
    >
      {value}
    </span>
  );
}
