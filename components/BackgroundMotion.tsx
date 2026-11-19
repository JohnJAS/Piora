import { useEffect, useRef } from "react";

export function BackgroundMotion() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("desktop-pet-document")) return;
    const scene = sceneRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
      root.dataset.appBackgroundMotion = active ? "running" : "paused";
    }

    function move(event: PointerEvent) {
      if (!active || event.pointerType !== "mouse") return;
      x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1)) * 10;
      y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1)) * 6;
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
    if (scene) {
      window.addEventListener("pointermove", move, { passive: true });
      root.addEventListener("pointerleave", center);
    }
    updateActivity();
    return () => {
      reducedMotion.removeEventListener("change", updateActivity);
      document.removeEventListener("visibilitychange", updateActivity);
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
      if (scene) {
        window.removeEventListener("pointermove", move);
        root.removeEventListener("pointerleave", center);
      }
      center();
      delete root.dataset.appBackgroundMotion;
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
