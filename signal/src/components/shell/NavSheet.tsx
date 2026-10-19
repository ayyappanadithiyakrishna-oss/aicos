"use client";
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { NavList } from "./SideNav";
import { prefersReducedMotion, project, rubberband, spring, velocityOf, type SpringHandle } from "@/lib/client/spring";

const HYSTERESIS = 10;

// Mobile navigation sheet. It tracks the finger 1:1, rubber-bands past its open edge,
// projects a flick's momentum to decide dismiss vs. return, hands the release velocity
// to a spring, and can be grabbed again mid-animation.
export function NavSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const anim = useRef<SpringHandle | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; base: number; x: number; axis: "x" | "y" | null; history: { x: number; t: number }[] } | null>(null);
  const suppressClick = useRef(false);

  const paint = (x: number) => {
    const el = sheet.current;
    if (!el) return;
    el.style.transform = x === 0 ? "" : `translateX(${x}px)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 + x / el.offsetWidth));
  };

  const settle = (x: number, velocity: number) => {
    const el = sheet.current;
    if (!el) return;
    const w = el.offsetWidth;
    const dismiss = x + project(velocity) < -w / 2;
    const target = dismiss ? -w : 0;
    const done = () => {
      anim.current = null;
      if (dismiss) {
        el.setAttribute("data-flung", "");
        onOpenChange(false);
      }
    };
    if (prefersReducedMotion()) {
      paint(target);
      done();
      return;
    }
    anim.current = spring(x, target, paint, { damping: 0.8, response: 0.3, velocity }, done);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Interrupt: start from the presentation value, never the target.
    let base = 0;
    if (anim.current) {
      base = anim.current.current().value;
      anim.current.cancel();
      anim.current = null;
    }
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base, x: base, axis: base !== 0 ? "x" : null, history: [{ x: e.clientX, t: e.timeStamp }] };
    suppressClick.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < HYSTERESIS) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already released; tracking continues via bubbling */
        }
      }
    }
    if (d.axis !== "x") return;
    suppressClick.current = true;
    const raw = d.base + dx;
    d.x = raw > 0 ? rubberband(raw, el.offsetWidth) : raw;
    d.history.push({ x: e.clientX, t: e.timeStamp });
    while (d.history.length > 2 && e.timeStamp - (d.history[0]?.t ?? e.timeStamp) > 100) d.history.shift();
    paint(d.x);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    settle(d.x, velocityOf(d.history));
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) sheet.current?.removeAttribute("data-flung");
        onOpenChange(o);
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay ref={scrim} className="mat-scrim fixed inset-0 bg-black/40" style={{ zIndex: "var(--z-overlay)" }} />
        <Dialog.Content
          ref={sheet}
          className="mat-sheet-left material-sheet fixed inset-y-0 left-0 flex w-[min(300px,86vw)] touch-pan-y flex-col p-3"
          style={{ zIndex: "var(--z-modal)" }}
          aria-describedby={undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={(e) => {
            if (suppressClick.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-semibold text-ink">Signal</Dialog.Title>
            <Dialog.Close className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-surface-3" aria-label="Close navigation">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavList onNavigate={() => onOpenChange(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
