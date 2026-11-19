"use strict";

exports.name = "piora-task-monitor-panel";
exports.inject = ["taskMonitor", "pioraPanel"];

exports.apply = (ctx) => {
  const monitor = ctx.get("taskMonitor");
  const panel = ctx.get("pioraPanel");
  ctx.effect(() => panel.register("monitor.health", () => ({ ready: true, version: monitor.version })));
  ctx.effect(() => panel.register("monitor.snapshot", () => monitor.snapshot()));
  ctx.effect(() => panel.register("monitor.set-compact", async value => {
    await monitor.setCompact(value);
    return monitor.snapshot();
  }));
};
