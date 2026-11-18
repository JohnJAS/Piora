const collator = new Intl.Collator();
const descriptions = new WeakMap();

function describe(entry) {
  const lowerPath = entry.path.toLowerCase();
  const slash = lowerPath.lastIndexOf("/");
  let depth = 0, mask = 0;
  for (let index = 0; index < lowerPath.length; index++) {
    const code = lowerPath.charCodeAt(index);
    if (code === 47) depth++;
    else if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
  }
  return { entry, lowerPath, lowerName: lowerPath.slice(slash + 1), depth, mask };
}

function describeAll(entries) {
  let prepared = descriptions.get(entries);
  if (!prepared) {
    prepared = entries.map(describe);
    descriptions.set(entries, prepared);
  }
  return prepared;
}

function comparePaths(left, right) {
  return left.depth - right.depth || collator.compare(left.entry.path, right.entry.path);
}

export function buildEntriesFromFiles(files) {
  const folders = new Set();
  for (const file of files) {
    for (let prefix = file.indexOf("/"); prefix !== -1; prefix = file.indexOf("/", prefix + 1)) folders.add(file.slice(0, prefix));
  }
  const prepared = Array.from(folders, path => describe({ path, isDir: true }));
  for (const path of files) if (path) prepared.push(describe({ path, isDir: false }));
  prepared.sort(comparePaths);
  const entries = prepared.map(item => item.entry);
  descriptions.set(entries, prepared);
  return entries;
}

function subsequence(needle, haystack) {
  let matched = 0;
  for (let position = 0; position < haystack.length && matched < needle.length; position++) {
    if (haystack.charCodeAt(position) === needle.charCodeAt(matched)) matched++;
  }
  return matched === needle.length;
}

function score(item, query, pathQuery) {
  const { lowerPath, lowerName } = item;
  const key = pathQuery ? lowerPath : lowerName;
  if (key === query) return 100;
  if (key.startsWith(query)) return 80;
  if (key.includes(query)) return 50;
  if (!pathQuery && lowerPath.includes(query)) return 30;
  return subsequence(query, lowerPath) ? 10 : 0;
}

export function filterFileEntries(entries, query, limit = 20, check = () => {}) {
  if (limit <= 0) return [];
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return entries.slice(0, limit);
  const pathQuery = lowerQuery.includes("/");
  let mask = 0;
  for (let index = 0; index < lowerQuery.length; index++) {
    const code = lowerQuery.charCodeAt(index);
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
  }
  const compare = (left, right) => right.score - left.score || comparePaths(left.item, right.item);
  const result = [];
  const prepared = describeAll(entries);
  for (let position = 0; position < prepared.length; position++) {
    if ((position & 1023) === 0) check();
    const item = prepared[position];
    if ((item.mask & mask) !== mask) continue;
    const rank = score(item, lowerQuery, pathQuery);
    if (!rank) continue;
    const candidate = { item, score: rank + (item.entry.isDir ? 10 : 0) };
    if (result.length >= limit && compare(candidate, result[result.length - 1]) >= 0) continue;
    let low = 0, high = result.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(candidate, result[middle]) < 0) high = middle;
      else low = middle + 1;
    }
    result.splice(low, 0, candidate);
    if (result.length > limit) result.pop();
  }
  return result.map(item => item.item.entry);
}
