import http from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { db } from "./db/index.js";
import { setIo } from "./services/runtime.js";
import { log } from "./utils/core.js";
import { warmProviders } from "./integrations/providers/index.js";
const app = createApp(),
  server = http.createServer(app),
  io = new Server(server, {
    cors: { origin: config.corsOrigins, credentials: true },
  });
if (config.trustProxy) app.set("trust proxy", config.trustProxy);
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const u = jwt.verify(token, config.jwtSecret) as any;
    const row = db()
      .prepare("SELECT token_version,status FROM users WHERE id=?")
      .get(u.id) as any;
    if (!row || row.status !== "ACTIVE" || row.token_version !== u.tokenVersion)
      throw new Error();
    socket.data.user = u;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.data.user.id}`);
  socket.join(`role:${socket.data.user.role}`);
  socket.on("join:incident", (incidentId: string) => {
    if (["COORDINATOR", "ADMIN"].includes(socket.data.user.role))
      socket.join(`incident:${incidentId}`);
  });
});
setIo(io);
void warmProviders();
server.listen(config.port, "0.0.0.0", () =>
  log("info", "server_started", { port: config.port }),
);
export { server, io };
