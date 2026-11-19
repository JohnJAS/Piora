import { openSync, fstatSync, closeSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

const CHUNK_BYTES = 64 * 1024;
const MAX_CACHE_ENTRIES = 150_000;
const MAX_CACHED_FILES = 24;
const CURRENT_VERSION = 3;
const MAX_PAGE_LINES = 180;

const indexes = new Map();
let cachedEntries = 0;

function revision(stat) {
  return [stat.dev, stat.ino, stat.birthtimeMs, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

function read(file, start, length) {
  const buffer = Buffer.allocUnsafe(length);
  let used = 0;
  while (used < length) {
    const count = readSync(file, buffer, used, length - used, start + used);
    if (!count) break;
    used += count;
  }
  return buffer.subarray(0, used);
}

function parse(buffer) {
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    return value && typeof value === "object" ? value : undefined;
  } catch { return undefined; }
}

function scan(file, start, end, accept, check, digest) {
  let offset = start, lineStart = start;
  let chunks = [];
  function push(newline) {
    const line = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    chunks = [];
    const entry = parse(line);
    if (entry) accept(entry, lineStart, newline - lineStart);
    lineStart = newline + 1;
  }
  while (offset < end) {
    check();
    const chunk = read(file, offset, Math.min(CHUNK_BYTES, end - offset));
    if (!chunk.length) break;
    digest.update(chunk);
    let cursor = 0;
    for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, cursor)) {
      chunks.push(chunk.subarray(cursor, newline));
      push(offset + newline);
      cursor = newline + 1;
    }
    if (cursor < chunk.length) chunks.push(chunk.subarray(cursor));
    offset += chunk.length;
  }
  if (chunks.length) push(offset);
  return lineStart === end;
}

function remember(path, index) {
  if (index.nodes.size > MAX_CACHE_ENTRIES) return;
  indexes.set(path, index);
  cachedEntries += index.nodes.size;
  while (indexes.size > MAX_CACHED_FILES || cachedEntries > MAX_CACHE_ENTRIES) {
    const oldest = indexes.keys().next().value;
    cachedEntries -= indexes.get(oldest).nodes.size;
    indexes.delete(oldest);
  }
}

function newIndex() {
  return { nodes: new Map(), receipts: new Set(), unsupported: false, totals: {
    known: 0, unknown: 0, cost: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } };
}

function countStats(totals, entry) {
  const addUsage = usage => {
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      if (Number.isFinite(usage?.[key])) totals.tokens[key] += usage[key];
    }
    const cost = usage?.cost?.total;
    if (Number.isFinite(cost)) { totals.cost += cost; totals.known++; }
    else totals.unknown++;
  };
  if (["usage", "compaction", "branch_summary"].includes(entry.type)) addUsage(entry.usage);
  if (entry.type !== "message" || !entry.message) return;
  const { role, content, usage } = entry.message;
  totals.totalMessages++;
  if (role === "user") totals.userMessages++;
  if (role === "assistant") {
    totals.assistantMessages++;
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type === "toolCall") totals.toolCalls++;
    }
    addUsage(usage);
  }
  if (role === "toolResult") {
    totals.toolResults++;
    if (usage !== undefined) addUsage(usage);
  }
}

function isDeletedUser(entry) {
  return entry.type === "custom" && entry.customType === "piora-deleted-message"
    && (entry.data?.deletedUser === true || entry.data?.role === "user" || typeof entry.data?.clientPromptId === "string");
}

function append(index, entry, offset, length) {
  if (!index.header) {
    if (entry.type !== "session" || entry.version !== CURRENT_VERSION || typeof entry.id !== "string") {
      index.unsupported = true;
    } else {
      index.header = entry;
    }
    return;
  }
  if (entry.type === "session" || typeof entry.id !== "string" || index.nodes.has(entry.id)) {
    index.unsupported = true;
    return;
  }
  const parent = index.nodes.get(entry.parentId);
  const role = entry.type === "message" ? entry.message?.role : null;
  const visible = (Boolean(role) && role !== "system") || entry.type === "compaction" || entry.type === "custom_message"
    || entry.type === "branch_summary" && Boolean(entry.summary) || isDeletedUser(entry);
  const node = { id: entry.id, parent, offset, length, visible,
    turn: role === "user" || entry.type === "branch_summary" && Boolean(entry.summary) || isDeletedUser(entry),
    previous: parent?.visible ? parent : parent?.previous,
    model: parent?.model ?? null, thinkingLevel: parent?.thinkingLevel ?? "off",
    compaction: parent?.compaction, depth: (parent?.depth ?? 0) + 1,
    latestChange: parent?.latestChange, previousReply: parent?.previousReply || role === "assistant",
  };
  if (entry.type === "compaction") {
    node.compaction = node;
    let candidate = index.nodes.get(entry.firstKeptEntryId);
    let ancestor = parent;
    while (candidate && ancestor && ancestor.depth > candidate.depth) ancestor = ancestor.parent;
    if (ancestor !== candidate) candidate = undefined;
    node.retainedDepth = candidate?.depth ?? node.depth;
  }
  if (entry.type === "model_change") {
    node.model = { provider: entry.provider, modelId: entry.modelId };
    node.changedModel = parent?.model;
    if (node.previousReply && node.previous && node.changedModel
      && (node.model.provider !== node.changedModel.provider || node.model.modelId !== node.changedModel.modelId)) {
      node.latestChange = node;
    }
  } else if (role === "assistant") node.model = { provider: entry.message.provider, modelId: entry.message.model };
  if (entry.type === "thinking_level_change") node.thinkingLevel = entry.thinkingLevel;
  if (entry.type === "session_info") index.name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
  if (entry.type === "custom" && entry.customType === "piora-system-prompt-binding") {
    const binding = entry.data;
    if (binding?.version === 1 && Number.isInteger(binding.revision) && binding.revision > 0
      && ["default", "template"].includes(binding.source) && typeof binding.appliedAt === "string"
      && [binding.templateId, binding.templateName, binding.prompt].every(value => value === null || typeof value === "string")) index.promptBinding = binding;
  }
  const promptId = role === "user" ? entry.message.clientPromptId
    : entry.type === "custom" && entry.customType === "piora-deleted-message" ? entry.data?.clientPromptId : undefined;
  if (typeof promptId === "string" && promptId) index.receipts.add(promptId);
  index.nodes.set(node.id, node);
  index.leaf = node;
  countStats(index.totals, entry);
}

function getIndex(file, path, stat, check) {
  const before = indexes.get(path);
  const currentRevision = revision(stat);
  if (before) {
    indexes.delete(path);
    cachedEntries -= before.nodes.size;
    if (before.revision === currentRevision) {
      remember(path, before);
      return before;
    }
  }
  let digest = createHash("sha256");
  let compatibleAppend = Boolean(before?.aligned && !before.unsupported && before.stat.dev === stat.dev && before.stat.ino === stat.ino
    && before.stat.birthtimeMs === stat.birthtimeMs && stat.size > before.stat.size && stat.mtimeMs >= before.stat.mtimeMs);
  if (compatibleAppend) {
    for (let offset = 0; offset < before.stat.size; offset += CHUNK_BYTES) {
      check();
      digest.update(read(file, offset, Math.min(CHUNK_BYTES, before.stat.size - offset)));
    }
    compatibleAppend = digest.copy().digest("hex") === before.prefix;
    if (!compatibleAppend) digest = createHash("sha256");
  }
  const next = compatibleAppend ? before : newIndex();
  next.aligned = scan(file, compatibleAppend ? before.stat.size : 0, stat.size, (entry, offset, length) => {
    if (!next.unsupported) append(next, entry, offset, length);
  }, check, digest);
  next.revision = currentRevision;
  next.generation = compatibleAppend ? before.generation : createHash("sha256").update(currentRevision).digest("hex");
  next.stat = stat;
  if (next.aligned && revision(fstatSync(file)) === currentRevision && !next.unsupported) {
    next.prefix = digest.digest("hex");
    remember(path, next);
  }
  return next;
}

function* reverseVisible(leaf, before) {
  const compaction = leaf?.compaction;
  let current = before ? before.previous : leaf?.visible ? leaf : leaf?.previous;
  if (!compaction || !before || before.depth > compaction.depth) {
    while (current && (!compaction || current.depth > compaction.depth)) {
      yield current;
      current = current.previous;
    }
    if (!compaction) return;
    current = compaction.previous;
  }
  while (current && current.depth >= compaction.retainedDepth) {
    yield current;
    current = current.previous;
  }
  yield compaction;
}

function* reverseTurns(leaf, before, check) {
  let current = [];
  for (const node of reverseVisible(leaf, before)) {
    if ((current.length & 255) === 0) check();
    current.push(node);
    if (node.turn) {
      yield current;
      current = [];
    }
  }
  if (current.length) yield current;
}

function modelNotices(leaf, nodes, check) {
  const included = new Set(nodes.map(node => node.id));
  if (!included.size) return [];
  const notices = [];
  const depth = nodes.reduce((minimum, node) => Math.min(minimum, node.depth ?? Infinity), Infinity);
  const latestDepth = nodes.reduce((maximum, node) => Math.max(maximum, node.depth ?? 0), 0);
  const compaction = leaf?.compaction;
  for (let change = leaf?.latestChange; change && change.depth >= depth; change = change.parent?.latestChange) {
    check();
    const anchor = change.previous === compaction && compaction?.previous?.depth >= compaction.retainedDepth
      ? compaction.previous : change.previous;
    if (anchor.depth > latestDepth) continue;
    if (included.has(anchor.id)) notices.push({
      id: change.id, afterEntryId: anchor.id, from: change.changedModel, to: change.model,
    });
  }
  return notices.reverse();
}

function page(file, index, data, check) {
  const leaf = data.leafId ? index.nodes.get(data.leafId) : index.leaf;
  if (data.leafId && !leaf) return { missingAnchor: true };
  if (data.generation && data.generation !== index.generation) return { stale: true };
  const selected = [];
  const cursor = data.before ? index.nodes.get(data.before) : undefined;
  if (data.before && (!cursor || !cursor.visible)) return { missingAnchor: true };
  if (cursor && cursor.depth >= (leaf?.depth ?? 0) + 1) return { missingAnchor: true };
  if (cursor && cursor === leaf?.compaction) return { missingAnchor: true };
  if (cursor && leaf?.compaction && cursor.depth < leaf.compaction.retainedDepth) return { missingAnchor: true };
  if (cursor && cursor !== leaf) {
    for (let node = leaf; node; node = node.parent) {
      if (node === cursor) break;
      if (node.depth <= cursor.depth) return { missingAnchor: true };
      if ((node.depth & 255) === 0) check();
    }
  }
  let focused = !data.around;
  let cost = 0, turns = 0, hasOlder = false, oldest;
  for (const batch of reverseTurns(leaf, cursor, check)) {
    check();
    if (!focused) {
      if (!batch.some(node => node.id === data.around)) continue;
      focused = true;
    }
    if (turns >= data.turns) { hasOlder = true; break; }
    const batchBytes = batch.reduce((sum, node) => sum + node.length + 32, 0);
    // Always deliver the first turn in full, even when it needs a page of its own.
    if (turns && (cost + batchBytes > data.bytes || selected.length + batch.length > MAX_PAGE_LINES)) {
      hasOlder = true;
      break;
    }
    turns++;
    oldest = batch.at(-1).id;
    for (const node of batch) selected.push(node);
    cost += batchBytes;
  }
  if (!focused) return { missingAnchor: true };
  return {
    generation: index.generation, revision: index.revision, name: index.name,
    leafId: leaf?.id ?? null, header: index.header, promptBinding: index.promptBinding,
    model: leaf?.model ?? null, thinkingLevel: leaf?.thinkingLevel ?? "off",
    before: hasOlder ? oldest : null,
    contextVersion: index.generation + ":" + (leaf?.compaction?.id ?? ""),
    modelChanges: modelNotices(leaf, selected, check),
    entries: selected.reverse().flatMap(node => {
      check();
      const entry = parse(read(file, node.offset, node.length));
      return entry?.id === node.id ? [entry] : [];
    }),
  };
}

export function readHistory(operation, data, check) {
  const descriptor = openSync(data.path, "r");
  try {
    const stat = fstatSync(descriptor);
    const index = getIndex(descriptor, data.path, stat, check);
    if (index.unsupported || !index.header) return { unsupported: true };
    let result;
    switch (operation) {
      case "sessionPage": result = page(descriptor, index, data, check); break;
      case "sessionReceipts": {
        const needed = new Set(data.anchors ?? []);
        const included = [];
        if (needed.size) {
          const leaf = data.leafId ? index.nodes.get(data.leafId) : index.leaf;
          for (const node of reverseVisible(leaf)) {
            if (needed.delete(node.id)) included.push(node.id);
            if (!needed.size) break;
            check();
          }
        }
        result = { ids: data.ids.filter(id => index.receipts.has(id)), activeAnchorIds: included };
        break;
      }
      case "sessionEntry": {
        const node = index.nodes.get(data.entryId);
        result = { entry: node ? parse(read(descriptor, node.offset, node.length)) : null };
        break;
      }
      case "sessionPromptBinding": result = { binding: index.promptBinding ?? null }; break;
      case "sessionStats": {
        const { known, unknown, tokens, ...totals } = index.totals;
        result = { stats: { ...totals,
          sessionId: index.header.id, sessionFile: data.path, sessionName: index.name, scope: "session",
          costStatus: known ? unknown ? "partial" : "known" : "unknown",
          tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
        } };
        break;
      }
      default: throw new Error("Unknown local history read");
    }
    if (revision(fstatSync(descriptor)) !== revision(stat)) return { stale: true };
    return result;
  } finally {
    closeSync(descriptor);
  }
}
