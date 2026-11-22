// Public facade barrel for collaboration room persistence and event streams.
// Domain implementation is split under lib/rooms/.
export {
  emitRoomPresence,
  getPrivateRoomDirectory,
  getRoom,
  getRoomsRoot,
  listRoomAudit,
  listRooms,
  subscribeRoom,
  subscribeRoomEvents,
  withRoomLockSync,
} from "./rooms/storage";
export {
  addManagedRoomMember,
  addRoomMember,
  assertRoomSessionIsolated,
  configureRoomCoordination,
  createRoom,
  deleteRoom,
  isolateRoomMemberSessions,
  removeRoomMember,
  updateRoomAgentBinding,
  updateRoomAgentProfile,
  updateRoomMember,
  updateRoomProfile,
  updateRoomWorkspace,
} from "./rooms/members";
export {
  appendPrivateNote,
  appendRoomMessage,
  findRoomMessage,
  findRoomMessageByCorrelationId,
  listPrivateNotes,
  listRoomMessages,
  readRoomMessageFullContent,
} from "./rooms/messages";
export {
  claimRoomTask,
  createRoomTask,
  finishRoomTask,
  getRoomTask,
  heartbeatRoomTask,
  listRoomTasks,
  releaseRoomTaskLease,
} from "./rooms/tasks";
export {
  listRoomArtifacts,
  publishRoomArtifact,
} from "./rooms/artifacts";
