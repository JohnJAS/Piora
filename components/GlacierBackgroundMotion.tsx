import { useEffect, useRef } from "react";

export function GlacierBackgroundMotion() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || document.documentElement.classList.contains("desktop-pet-document")) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let active = false;
    let frame: number | null = null;
    let x = 0;
    let y = 0;

    function center() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      scene?.style.removeProperty("--glacier-x");
      scene?.style.removeProperty("--glacier-y");
    }

    function updateActivity() {
      active = !reducedMotion.matches && document.visibilityState === "visible" && document.hasFocus();
      if (!active) center();
      scene?.toggleAttribute("data-motion-running", active);
    }

    function move(event: PointerEvent) {
      if (!active || event.pointerType !== "mouse") return;
      x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1)) * 13;
      y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1)) * 8;
      if (frame !== null) return;

      frame = requestAnimationFrame(() => {
        frame = null;
        scene?.style.setProperty("--glacier-x", `${x.toFixed(2)}px`);
        scene?.style.setProperty("--glacier-y", `${y.toFixed(2)}px`);
      });
    }

    reducedMotion.addEventListener("change", updateActivity);
    document.addEventListener("visibilitychange", updateActivity);
    window.addEventListener("focus", updateActivity);
    window.addEventListener("blur", updateActivity);
    window.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", center);
    updateActivity();
    return () => {
      reducedMotion.removeEventListener("change", updateActivity);
      document.removeEventListener("visibilitychange", updateActivity);
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
      window.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", center);
      center();
      scene.removeAttribute("data-motion-running");
    };
  }, []);

  return (
    <div className="glacier-background-motion" aria-hidden="true" ref={sceneRef}>
      <div className="glacier-facets glacier-facets-middle" />
      <div className="glacier-facets glacier-facets-front" />
      <div className="glacier-glint" />
    </div>
  );
}
