exports.inject = ["pioraStorage", "pioraPanel"];

const storageKey = "community-storage";

exports.apply = (ctx, { version }) => {
  const { pioraStorage, pioraPanel } = ctx;
  let saved = Promise.resolve();
  pioraPanel.register("community.health", async () => {
    const storage = await pioraStorage.read(storageKey);
    return { ready: storage === null || Array.isArray(storage), version };
  });
  pioraPanel.register("community.storage.read", async () => {
    await saved;
    return await pioraStorage.read(storageKey) ?? [];
  });
  pioraPanel.register("community.storage.write", entries => {
    if (!Array.isArray(entries) || entries.length > 256 || entries.some(entry =>
      !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string")) {
      throw new Error("Invalid community panel storage");
    }
    const write = saved.then(() => pioraStorage.write(storageKey, entries));
    saved = write.catch(() => {});
    return write;
  });
};
