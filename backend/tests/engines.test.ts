import { describe,expect,it } from 'vitest';
import { calculatePriority,calculateSeverity,escalationRecommendation,rankResponders,assertTransition } from '../src/services/engines.js';
import { haversineKm } from '../src/utils/core.js';
describe('deterministic engines',()=>{
  it('calculates geographic distance',()=>expect(haversineKm({latitude:0,longitude:0},{latitude:0,longitude:1})).toBeCloseTo(111.2,0));
  it('explains critical request priority',()=>{const p=calculatePriority({medicalEmergency:true,vulnerabilities:['ELDERLY','MOBILITY'],immediateDanger:true,peopleCount:5,distanceToDangerKm:1,incidentSeverity:90,availableResponders:0});expect(p.level).toBe('CRITICAL');expect(p.reasons).toContain('Medical emergency');});
  it('calculates weighted severity',()=>{const s=calculateSeverity({threat:100,population:100,requests:100,vulnerable:100,spread:100,weather:100,roads:100,responderGap:100,delays:100,shelter:100},20);expect(s.score).toBe(100);expect(s.level).toBe('CRITICAL');expect(s.scoreChange).toBe(80);});
  it('ranks compatible nearby responders',()=>{const matches=rankResponders({latitude:12,longitude:77,category:'TRANSPORTATION',people_count:2},[{id:'r1',user_id:'u1',latitude:12.001,longitude:77,availability:1,status:'AVAILABLE',verification_status:'VERIFIED',capabilities:'["TRANSPORT"]',vehicle_available:1,passenger_capacity:4,reliability_score:90},{id:'r2',user_id:'u2',latitude:12.1,longitude:77,availability:1,status:'AVAILABLE',verification_status:'VERIFIED',capabilities:'["GENERAL_ASSISTANCE"]',vehicle_available:0,passenger_capacity:0,reliability_score:80}]);expect(matches.map(x=>x.responderId)).toEqual(['r1']);});
  it('rejects invalid assignment transitions',()=>expect(()=>assertTransition('ASSIGNED','ARRIVED')).toThrow(/Invalid/));
  it('recommends authorized escalation',()=>{const e=escalationRecommendation({severity:95,unresolved:12,responders:1,medical:2,delayMinutes:40,blockedRoutes:3,shelterUtilization:.95});expect(e.shouldEscalate).toBe(true);expect(e.recommendedLevel).toBe('HIGHER_LEVEL_AUTHORIZED_RESPONSE');});
});
