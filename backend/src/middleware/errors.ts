import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { log } from '../utils/core.js';
export const asyncRoute = (fn: Function) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req,res,next)).catch(next);
export function notFound(req: Request, res: Response) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }); }
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  log('error','request_failed',{ method:req.method,path:req.path,error:err.message });
  if (err instanceof ZodError) return res.status(400).json({ success:false,error:{code:'VALIDATION_ERROR',message:'Invalid request',details:err.issues} });
  return res.status(err.status || 500).json({ success:false,error:{code:err.code || 'INTERNAL_ERROR',message:err.status ? err.message : 'An internal error occurred'} });
}
