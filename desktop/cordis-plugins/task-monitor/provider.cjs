"use strict";

exports.name = "piora-task-monitor-provider";
exports.inject = ["pioraTasks", "pioraStorage"];

exports.apply = (ctx) => {
  const version = require("./package.json").version;
  const tasks = ctx.get("pioraTasks");
  const storage = ctx.get("pioraStorage");
  ctx.provide("taskMonitor", {
    version,
    async snapshot() {
      const list = await tasks.list();
      return {
        version,
        running: list.filter(task => task.running).length,
        awaitingApproval: list.filter(task => task.awaitingApproval).length,
        compact: (await storage.read("preferences"))?.compact === true,
      };
    },
    async setCompact(value) {
      await storage.write("preferences", { compact: value === true });
    },
  });
};

exports.migrate = async (storage, from, to) => {
  if (from !== 1 || to !== 2) throw new Error("Unsupported Task Monitor data migration");
  const previous = await storage.read("preferences");
  await storage.write("preferences", { compact: previous?.compact === true });
};
