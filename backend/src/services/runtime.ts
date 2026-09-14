import type { Server } from 'socket.io';
let io: Server | undefined;
export const setIo = (server: Server) => { io = server; };
export const emit = (event: string, payload: unknown, room?: string) => room ? io?.to(room).emit(event, payload) : io?.emit(event, payload);
