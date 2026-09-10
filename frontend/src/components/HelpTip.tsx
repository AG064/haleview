import { useEffect, useId, useRef, useState } from "react";

export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const show = () => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(280, window.innerWidth - 32);
    setPosition({ left: Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)), top: Math.max(16, Math.min(bounds.bottom + 8, window.innerHeight - 150)) });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  return <span ref={ref} className="field-help" onPointerEnter={event => { if (event.pointerType === "mouse") show(); }} onPointerLeave={event => { if (event.pointerType === "mouse") setOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="field-help-trigger" aria-label={`About ${label}`} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) show(); }}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}>?</button>
    {open && <span id={id} role="tooltip" className="field-help-tip" style={position}>{text}</span>}
  </span>;
}
