import type { Server } from "socket.io";
let io: Server | undefined;
export const setIo = (server: Server) => {
  io = server;
};
export const emitToRoom = (event: string, payload: unknown, room: string) =>
  io?.to(room).emit(event, payload);
export const emitToUsers = (
  event: string,
  payload: unknown,
  userIds: Array<string | null | undefined>,
) => {
  for (const userId of new Set(userIds.filter(Boolean)))
    io?.to(`user:${userId}`).emit(event, payload);
};
export const emitToRoles = (
  event: string,
  payload: unknown,
  roles: string[] = ["COORDINATOR", "ADMIN"],
) => {
  for (const role of roles) io?.to(`role:${role}`).emit(event, payload);
};
export const emitOperational = (
  event: string,
  payload: unknown,
  userIds: Array<string | null | undefined> = [],
) => {
  emitToRoles(event, payload);
  emitToUsers(event, payload, userIds);
};
