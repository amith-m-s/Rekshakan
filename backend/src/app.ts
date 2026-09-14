import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/index.js';
import { db } from './db/index.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { openapi } from './openapi.js';
import path from 'node:path';

export function createApp(){db();const app=express();app.disable('x-powered-by');app.use('/docs',helmet({contentSecurityPolicy:false}),swaggerUi.serve,swaggerUi.setup(openapi));app.use(helmet({contentSecurityPolicy:{directives:{scriptSrc:["'self'"],connectSrc:["'self'","ws:","wss:"]}}}));app.use(cors({origin:(origin,cb)=>!origin||config.corsOrigins.includes(origin)?cb(null,true):cb(new Error('Origin not allowed')),credentials:true}));app.use(express.json({limit:'256kb'}));app.use('/api/auth',rateLimit({windowMs:60_000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}));app.use('/api/help-requests',rateLimit({windowMs:60_000,limit:60,standardHeaders:'draft-8',legacyHeaders:false}));app.use('/api',routes);app.use(express.static(path.resolve(process.cwd(),'public')));app.use(notFound);app.use(errorHandler);return app;}
