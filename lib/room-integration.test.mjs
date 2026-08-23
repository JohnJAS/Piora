import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { FIRST_PARTY_EXTENSIONS } = await jiti.import("./first-party-extensions.ts");

const store = await readFile(new URL("./room-store.ts", import.meta.url), "utf8");
const extension = await readFile(new URL("../extensions/piora-room.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/RoomWorkspace.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../components/RoomSettingsDialog.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../components/RoomSidebarSection.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./room-chat.ts", import.meta.url), "utf8");
const staging = await readFile(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");
const coordinator = await readFile(new URL("./room-coordinator.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/rooms/[id]/route.ts", import.meta.url), "utf8");
const eventsApi = await readFile(new URL("../app/api/rooms/[id]/events/route.ts", import.meta.url), "utf8");

test("collaboration rooms expose shared and private persisted regions", () => {
  assert.match(store, /"shared", "messages\.jsonl"/);
  assert.match(store, /"private"/);
  assert.match(store, /appendPrivateNote/);
  assert.match(store, /subscribeRoom/);
});

test("coordinator dispatch uses leases, dedupe, and bounded concurrency", () => {
  assert.match(store, /dedupeKey/);
  assert.match(store, /最大并发数/);
  assert.match(store, /leaseDurationMs/);
  assert.match(store, /requireLease/);
  assert.match(coordinator, /claimRoomTask/);
  assert.match(coordinator, /releaseRoomTaskLease/);
  assert.match(coordinator, /PIORA COORDINATOR TASK/);
  assert.match(api, /dispatchReadyRoomTasks/);
  assert.match(workspace, /action: "dispatch"/);
  assert.match(workspace, /任务“\$\{task\.title\}”/);
});

test("Room tasks expose the shared TaskRun projection without replacing Room leases", () => {
  assert.match(api, /projectRoomTaskRun/);
  assert.match(api, /taskRuns:/);
  assert.match(eventsApi, /taskRunFor/);
  assert.match(eventsApi, /taskRun:/);
  assert.match(workspace, /Map<string, TaskRunState>/);
  assert.match(workspace, /taskRuns\.get\(task\.id\)\?\.phase/);
  assert.match(store, /requireLease/);
});

test("worktree-aware tasks publish shared artifacts without workspace collisions", () => {
  assert.match(store, /use a separate worktree for parallel work/);
  assert.match(store, /publishRoomArtifact/);
  assert.match(store, /Artifact source must stay inside/);
  assert.match(extension, /Type\.Literal\("publish_artifact"\)/);
  assert.match(coordinator, /Worktree branch/);
  assert.match(workspace, /公共产物/);
  assert.match(api, /export async function DELETE/);
});

test("room extension and first-class group chat support multi-session communication", () => {
  assert.match(extension, /name: "piora_room"/);
  assert.match(extension, /Type\.Literal\("send_shared"\)/);
  assert.match(extension, /before_agent_start/);
  assert.match(workspace, /EventSource/);
  assert.match(workspace, /max-width: 820px/);
  assert.match(workspace, /detailsBackdrop/);
  assert.match(workspace, /action: "chat"/);
  assert.match(workspace, /resolveRoomChatTargets/);
  assert.match(workspace, /mentionMenu/);
  assert.match(workspace, /正在处理/);
  assert.match(sidebar, /新建群聊/);
  assert.match(sidebar, /其他成员和说明都可以稍后设置/);
  assert.match(sidebar, /members:/);
  assert.match(chat, /PIORA GROUP CHAT/);
  assert.match(chat, /type: behavior/);
  assert.match(chat, /relayRoomReply/);
  assert.match(chat, /emitRoomPresence/);
  assert.match(chat, /getLastAssistantText/);
  assert.match(extension, /replyTo/);
  assert.equal(
    FIRST_PARTY_EXTENSIONS.some(({ id, fileName, profiles }) => (
      id === "piora:room"
      && fileName === "piora-room.ts"
      && profiles.includes("normal")
      && !profiles.includes("device-control")
    )),
    true,
  );
  assert.match(staging, /extensions\/piora-room\.ts/);
});

test("collaboration settings manage room identity, Agent bindings, roles, and workspace contracts", () => {
  assert.match(settings, /action: "update_room"/);
  assert.match(settings, /action: "update_member"/);
  assert.match(settings, /action: "add_member"/);
  assert.match(settings, /targetSessionId/);
  assert.match(settings, /action: "update_workspace"/);
  assert.match(settings, /职责与约束/);
  assert.match(settings, /共享工作区/);
  assert.match(api, /updateRoomProfile/);
  assert.match(api, /updateRoomMember/);
  assert.match(api, /updateRoomWorkspace/);
  assert.match(api, /listRoomAudit/);
  assert.match(extension, /Workspace contract/);
  assert.match(settings, /最近变更/);
});

test("room settings delete a collaboration room and clear the selected workspace", () => {
  assert.match(settings, /requestConfirmation/);
  assert.match(settings, /method: "DELETE"/);
  assert.match(settings, /onRoomDeleted\(room\.id\)/);
  assert.match(settings, /永久删除群聊消息、任务、共享产物和所有协作配置/);
  assert.match(shell, /const handleRoomDeleted/);
  assert.match(shell, /onRoomDeleted=\{handleRoomDeleted\}/);
  assert.match(shell, /setRefreshKey\(\(key\) => key \+ 1\)/);
  assert.match(sidebar, /\[loadRooms, refreshKey\]/);
});
