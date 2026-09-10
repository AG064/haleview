import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

interface AppAccordionProps {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  eyebrow?: string;
  meta?: string;
  defaultOpen?: boolean;
  tone?: "sage" | "oat" | "clay";
  className?: string;
}

export function AppAccordion({
  title,
  icon: Icon,
  children,
  eyebrow,
  meta,
  defaultOpen = false,
  tone = "sage",
  className = "",
}: AppAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className={`app-accordion tone-${tone} ${className}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="app-accordion-icon"><Icon aria-hidden="true" /></span>
        <span className="app-accordion-copy">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <strong>{title}</strong>
        </span>
        {meta && <span className="app-accordion-meta">{meta}</span>}
        <ChevronDown className="app-accordion-chevron" aria-hidden="true" />
      </summary>
      <div className="app-accordion-body">{children}</div>
    </details>
  );
}
