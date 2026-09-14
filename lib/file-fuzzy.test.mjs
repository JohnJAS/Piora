import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-fuzzy.ts");
}

test("bounded file ranking retains exact, prefix, substring, path and fuzzy priorities", async () => {
  const { filterFileEntries } = await loadSubject();
  const entries = [
    { path: "deep/foo/item.ts", isDir: false },
    { path: "food.ts", isDir: false },
    { path: "a/foo", isDir: false },
    { path: "foo", isDir: true },
    { path: "zfoo.ts", isDir: false },
    { path: "f-o-o.ts", isDir: false },
    { path: "foo", isDir: false },
  ];
  assert.deepEqual(filterFileEntries(entries, "foo", 5).map(entry => [entry.path, entry.isDir]), [
    ["foo", true], ["foo", false], ["a/foo", false], ["food.ts", false], ["zfoo.ts", false],
  ]);
  assert.deepEqual(filterFileEntries(entries, "deep/foo/", 1).map(entry => entry.path), ["deep/foo/item.ts"]);
  assert.deepEqual(filterFileEntries(entries, "FOO", 3), filterFileEntries(entries, "foo", 3));
  assert.deepEqual(filterFileEntries(entries, "foo", 0), []);
});

test("best file matches beyond the client index cap still win over early matches", async () => {
  const { filterFileEntries } = await loadSubject();
  const entries = Array.from({ length: 10_000 }, (_, i) => ({ path: `deep/${i}/target-other.ts`, isDir: false }));
  entries.push({ path: "target", isDir: false }, { path: "target", isDir: true });
  assert.deepEqual(filterFileEntries(entries, "target", 2), [{ path: "target", isDir: true }, { path: "target", isDir: false }]);
});

test("builds closed file mentions and quotes paths containing spaces", async () => {
  const { buildAtMentionText, buildFileAtMentionsText } = await loadSubject();

  assert.equal(buildAtMentionText("notes/todo.md", false), "@notes/todo.md ");
  assert.equal(buildAtMentionText("project files/design brief.md", false), "@\"project files/design brief.md\" ");
  assert.equal(
    buildFileAtMentionsText(["notes/todo.md", "project files/design brief.md"]),
    "@notes/todo.md @\"project files/design brief.md\" ",
  );
});

test("builds line-scoped file mentions", async () => {
  const { buildFileLineMentionText } = await loadSubject();

  assert.equal(buildFileLineMentionText("src/app.ts", 12, 12), "@src/app.ts:12 ");
  assert.equal(buildFileLineMentionText("src/app.ts", 18, 12), "@src/app.ts:12-18 ");
  assert.equal(
    buildFileLineMentionText("project files/app.ts", 3, 9),
    "@\"project files/app.ts\":3-9 ",
  );
  assert.equal(buildFileLineMentionText("src/app.ts", 0, 0), "@src/app.ts:1 ");
});
