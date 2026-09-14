import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { db } from "../db/index.js";

export type AuthUser = {
  id: string;
  role: "RESIDENT" | "RESPONDER" | "COORDINATOR" | "ADMIN";
  tokenVersion: number;
};
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
export function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token)
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Access token required" },
      });
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    const user = db()
      .prepare("SELECT id,role,status,token_version FROM users WHERE id=?")
      .get(decoded.id) as any;
    if (
      !user ||
      user.status !== "ACTIVE" ||
      user.token_version !== decoded.tokenVersion
    )
      return res.status(401).json({
        success: false,
        error: { code: "TOKEN_INVALID", message: "Token is no longer valid" },
      });
    req.user = {
      id: user.id,
      role: user.role,
      tokenVersion: user.token_version,
    };
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: {
        code: "TOKEN_INVALID",
        message: "Invalid or expired access token",
      },
    });
  }
}
export const roles =
  (...allowed: AuthUser["role"][]) =>
  (req: Request, res: Response, next: NextFunction) =>
    allowed.includes(req.user!.role)
      ? next()
      : res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Insufficient permissions" },
        });
