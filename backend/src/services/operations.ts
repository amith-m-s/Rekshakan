import { db } from '../db/index.js';
import { audit } from './audit.js';
import { calculatePriority, calculateSeverity, escalationRecommendation, rankResponders } from './engines.js';
import { config } from '../config/index.js';
import { emit } from './runtime.js';
import { haversineKm, id, now, parseJson } from '../utils/core.js';

export function notify(userId: string | null, incidentId: string | null, type: string, title: string, body: string, dedupeKey?: string) {
  const n = { id:id('not'), user_id:userId, incident_id:incidentId, type,title,body,channel:'IN_APP',dedupe_key:dedupeKey||null,created_at:now() };
  try { db().prepare('INSERT INTO notifications(id,user_id,incident_id,type,title,body,channel,dedupe_key,created_at) VALUES(@id,@user_id,@incident_id,@type,@title,@body,@channel,@dedupe_key,@created_at)').run(n); emit('notification.created', n, userId ? `user:${userId}` : undefined); return n; } catch (e:any) { if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return null; throw e; }
}
export function createHelpRequest(userId:string, body:any) {
  const incident = db().prepare('SELECT * FROM incidents WHERE id=?').get(body.incidentId) as any;
  if (!incident) throw Object.assign(new Error('Incident not found'),{status:404});
  const available = (db().prepare("SELECT count(*) n FROM responders WHERE availability=1 AND status='AVAILABLE'").get() as any).n;
  const p = calculatePriority({ medicalEmergency:body.medicalEmergency,vulnerabilities:body.vulnerabilities,immediateDanger:body.immediateDanger,peopleCount:body.peopleCount,distanceToDangerKm:haversineKm(body,{latitude:incident.latitude,longitude:incident.longitude}),incidentSeverity:incident.severity_score,availableResponders:available });
  const r = { id:id('req'),client_request_id:body.clientRequestId||null,resident_id:userId,incident_id:body.incidentId,latitude:body.latitude,longitude:body.longitude,category:body.category,description:body.description||null,people_count:body.peopleCount||1,medical_emergency:body.medicalEmergency?1:0,vulnerabilities:JSON.stringify(body.vulnerabilities||[]),immediate_danger:body.immediateDanger?1:0,priority_score:p.score,priority_level:p.level,priority_reasons:JSON.stringify(p.reasons),status:'REQUESTED',created_at:now(),updated_at:now() };
  try { db().prepare(`INSERT INTO help_requests VALUES(@id,@client_request_id,@resident_id,@incident_id,@latitude,@longitude,@category,@description,@people_count,@medical_emergency,@vulnerabilities,@immediate_danger,@priority_score,@priority_level,@priority_reasons,@status,@created_at,@updated_at)`).run(r); } catch(e:any) { if(e.code==='SQLITE_CONSTRAINT_UNIQUE') return db().prepare('SELECT * FROM help_requests WHERE resident_id=? AND client_request_id=?').get(userId,body.clientRequestId); throw e; }
  db().prepare("UPDATE users SET operational_status='NEEDS_HELP',updated_at=? WHERE id=?").run(now(),userId);
  audit('HELP_REQUEST_CREATED',{incidentId:r.incident_id,requestId:r.id,actorId:userId,newState:'REQUESTED',latitude:r.latitude,longitude:r.longitude,metadata:{priority:p}}); emit('help_request.created',r); return {...r,priorityReasons:p.reasons};
}
export function recomputeSeverity(incidentId:string, overrides:Record<string,number>={}, actorId?:string) {
  const incident=db().prepare('SELECT * FROM incidents WHERE id=?').get(incidentId) as any; if(!incident) throw Object.assign(new Error('Incident not found'),{status:404});
  const counts=db().prepare(`SELECT count(*) total,sum(medical_emergency) medical FROM help_requests WHERE incident_id=? AND status NOT IN ('SAFE','CLOSED','CANCELLED')`).get(incidentId) as any;
  const available=(db().prepare("SELECT count(*) n FROM responders WHERE availability=1 AND status='AVAILABLE'").get() as any).n;
  const current=parseJson(incident.severity_factors,{} as Record<string,number>);
  const result=calculateSeverity({...current,requests:Math.min(100,counts.total*12),vulnerable:Math.min(100,(counts.medical||0)*25),responderGap:Math.min(100,Math.max(0,counts.total-available)*20),...overrides},incident.severity_score);
  db().prepare('UPDATE incidents SET severity_score=?,severity_level=?,severity_factors=?,severity_reasons=?,updated_at=? WHERE id=?').run(result.score,result.level,JSON.stringify(result.factors),JSON.stringify(result.reasons),now(),incidentId);
  if(result.score!==incident.severity_score){ audit('INCIDENT_SEVERITY_CHANGED',{incidentId,actorId,previousState:String(incident.severity_score),newState:String(result.score),metadata:result}); emit('incident.severity_changed',{incidentId,...result}); createGeofenceAlerts(incidentId,result.level); }
  return result;
}
export function createGeofenceAlerts(incidentId:string, level:string) {
  const incident=db().prepare('SELECT * FROM incidents WHERE id=?').get(incidentId) as any; const radius=config.alertRadiiKm[level] || incident.radius_km;
  const users=db().prepare(`SELECT u.id,u.name,l.latitude,l.longitude FROM users u JOIN locations l ON l.id=(SELECT id FROM locations WHERE user_id=u.id ORDER BY recorded_at DESC LIMIT 1) WHERE u.alerts_opt_in=1 AND l.sharing_state='SHARED'`).all() as any[];
  return users.filter(u=>haversineKm(incident,u)<=radius).map(u=>notify(u.id,incidentId,'INCIDENT_ALERT',`${level} ${incident.disaster_type} alert`,`${incident.name} is within ${radius} km. Follow authorized safety guidance.`,`alert:${incidentId}:${u.id}:${level}`)).filter(Boolean);
}
export function getMatches(requestId:string) {
  const request=db().prepare('SELECT * FROM help_requests WHERE id=?').get(requestId) as any; if(!request) throw Object.assign(new Error('Help request not found'),{status:404});
  const responders=db().prepare(`SELECT r.*,l.latitude,l.longitude FROM responders r JOIN locations l ON l.id=(SELECT id FROM locations WHERE user_id=r.user_id ORDER BY recorded_at DESC LIMIT 1)`).all() as any[];
  const matches=rankResponders(request,responders); audit('RESPONDER_MATCHED',{incidentId:request.incident_id,requestId,metadata:{matches:matches.map(m=>m.responderId)}}); return matches;
}
export function transitionAssignment(assignmentId:string,to:string,actorId:string,reason?:string) {
  const a=db().prepare('SELECT a.*,h.incident_id,h.resident_id FROM assignments a JOIN help_requests h ON h.id=a.request_id WHERE a.id=?').get(assignmentId) as any; if(!a) throw Object.assign(new Error('Assignment not found'),{status:404});
  const { assertTransition }=requireEngine(); assertTransition(a.status,to);
  const t=now(); db().transaction(()=>{ db().prepare('UPDATE assignments SET status=?,rejection_reason=CASE WHEN ?=\'REJECTED\' THEN ? ELSE rejection_reason END,failure_reason=CASE WHEN ?=\'FAILED\' THEN ? ELSE failure_reason END,accepted_at=CASE WHEN ?=\'ACCEPTED\' THEN ? ELSE accepted_at END,completed_at=CASE WHEN ? IN (\'COMPLETED\',\'CLOSED\') THEN ? ELSE completed_at END,updated_at=? WHERE id=?').run(to,to,reason||null,to,reason||null,to,t,to,t,t,assignmentId);
    const requestStatus=to==='REJECTED'||to==='FAILED'||to==='REASSIGNED'?'REASSIGNED':to; db().prepare('UPDATE help_requests SET status=?,updated_at=? WHERE id=?').run(requestStatus,t,a.request_id);
    if(['REJECTED','FAILED','REASSIGNED','CLOSED','CANCELLED'].includes(to)) db().prepare("UPDATE responders SET availability=CASE WHEN ? IN ('CLOSED','CANCELLED') THEN 1 ELSE availability END,current_assignment_id=NULL,status=CASE WHEN ? IN ('CLOSED','CANCELLED') THEN 'AVAILABLE' ELSE status END,updated_at=? WHERE id=?").run(to,to,t,a.responder_id);
  })();
  const action:Record<string,string>={ACCEPTED:'ASSIGNMENT_ACCEPTED',EN_ROUTE:'RESPONDER_EN_ROUTE',ARRIVED:'RESPONDER_ARRIVED',ASSISTING:'ASSISTANCE_STARTED',EVACUATED:'PERSON_EVACUATED',SHELTER_CHECKIN:'SHELTER_CHECKIN',SAFE:'PERSON_SAFE',CLOSED:'CASE_CLOSED'};
  audit(action[to]||`ASSIGNMENT_${to}`,{incidentId:a.incident_id,requestId:a.request_id,assignmentId,actorId,previousState:a.status,newState:to,metadata:{reason}}); emit('assignment.status_changed',{assignmentId,status:to,requestId:a.request_id}); notify(a.resident_id,a.incident_id,'ASSIGNMENT_UPDATE','Assistance update',`Your assistance request is now ${to}.`); return db().prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
}
function requireEngine(){ return { assertTransition:(from:string,to:string)=>{ const map:Record<string,string[]>={ASSIGNED:['ACCEPTED','REJECTED','CANCELLED','FAILED','REASSIGNED'],ACCEPTED:['EN_ROUTE','CANCELLED','FAILED','REASSIGNED'],EN_ROUTE:['ARRIVED','FAILED','REASSIGNED'],ARRIVED:['ASSISTING','FAILED'],ASSISTING:['EVACUATED','COMPLETED','FAILED'],EVACUATED:['SHELTER_CHECKIN','SAFE','COMPLETED'],SHELTER_CHECKIN:['SAFE','COMPLETED'],SAFE:['CLOSED'],COMPLETED:['CLOSED'],REJECTED:['REASSIGNED'],FAILED:['REASSIGNED']}; if(!map[from]?.includes(to))throw Object.assign(new Error(`Invalid assignment transition: ${from} -> ${to}`),{status:409}); } }; }
export function recommendEscalation(incidentId:string){ const i=db().prepare('SELECT * FROM incidents WHERE id=?').get(incidentId) as any;if(!i)throw Object.assign(new Error('Incident not found'),{status:404}); const stats=db().prepare(`SELECT count(*) unresolved,sum(medical_emergency) medical FROM help_requests WHERE incident_id=? AND status NOT IN ('SAFE','CLOSED','CANCELLED')`).get(incidentId) as any;const responders=(db().prepare("SELECT count(*) n FROM responders WHERE availability=1").get() as any).n;const blocked=(db().prepare("SELECT count(*) n FROM community_reports WHERE incident_id=? AND category='BLOCKED_ROAD' AND verification_status='VERIFIED'").get(incidentId) as any).n;const shelter=db().prepare('SELECT coalesce(sum(occupancy)*1.0/nullif(sum(capacity),0),0) util FROM shelters WHERE incident_id=?').get(incidentId) as any;return escalationRecommendation({severity:i.severity_score,unresolved:stats.unresolved,responders,medical:stats.medical||0,delayMinutes:0,blockedRoutes:blocked,shelterUtilization:shelter.util}); }
