import { config } from "../config/index.js";
import {
  clamp,
  haversineKm,
  priorityLevel,
  severityLevel,
} from "../utils/core.js";

export type SeverityInput = {
  threat?: number;
  population?: number;
  requests?: number;
  vulnerable?: number;
  spread?: number;
  weather?: number;
  roads?: number;
  responderGap?: number;
  delays?: number;
  shelter?: number;
};
export function calculateSeverity(input: SeverityInput, previousScore = 0) {
  const factors = Object.fromEntries(
    Object.keys(config.severityWeights).map((k) => [
      k,
      clamp(Number(input[k as keyof SeverityInput] || 0)),
    ]),
  ) as Record<string, number>;
  const score = Math.round(
    Object.entries(config.severityWeights).reduce(
      (n, [k, w]) => n + factors[k] * w,
      0,
    ),
  );
  const reasons: string[] = [];
  if (factors.threat >= 70) reasons.push("Immediate threat is severe");
  if (factors.population >= 70) reasons.push("High population exposure");
  if (factors.requests >= 70) reasons.push("Increasing emergency requests");
  if (factors.vulnerable >= 60)
    reasons.push("Vulnerable or medical cases require attention");
  if (factors.spread >= 70) reasons.push("Rapid fire spread");
  if (factors.weather >= 70)
    reasons.push("Adverse wind and weather conditions");
  if (factors.roads >= 60)
    reasons.push("Road or infrastructure access is constrained");
  if (factors.responderGap >= 60)
    reasons.push("Insufficient nearby responders");
  if (factors.delays >= 60) reasons.push("Response delays are increasing");
  if (factors.shelter >= 70) reasons.push("Shelter capacity is constrained");
  return {
    score,
    level: severityLevel(score),
    factors,
    reasons,
    previousScore,
    scoreChange: score - previousScore,
    timestamp: new Date().toISOString(),
  };
}

export function calculatePriority(input: {
  medicalEmergency?: boolean;
  vulnerabilities?: string[];
  immediateDanger?: boolean;
  peopleCount?: number;
  distanceToDangerKm?: number;
  incidentSeverity?: number;
  requestAgeMinutes?: number;
  availableResponders?: number;
}) {
  const reasons: string[] = [];
  let score = 0;
  if (input.medicalEmergency) {
    score += 30;
    reasons.push("Medical emergency");
  }
  if (input.vulnerabilities?.length) {
    score += Math.min(20, input.vulnerabilities.length * 8);
    reasons.push("Vulnerability indicators present");
  }
  if (input.immediateDanger) {
    score += 20;
    reasons.push("Immediate danger reported");
  }
  if ((input.peopleCount || 1) > 1) {
    score += Math.min(10, (input.peopleCount! - 1) * 2);
    reasons.push("Multiple people need assistance");
  }
  if ((input.distanceToDangerKm ?? 99) < 2) {
    score += 10;
    reasons.push("Close to incident center");
  }
  if ((input.incidentSeverity || 0) >= 60) {
    score += 10;
    reasons.push("Incident severity is high");
  }
  if ((input.requestAgeMinutes || 0) >= 30) {
    score += 8;
    reasons.push("Request has been waiting");
  }
  if ((input.availableResponders ?? 1) === 0) {
    score += 8;
    reasons.push("No responders currently available");
  }
  score = clamp(score);
  return { score, level: priorityLevel(score), reasons };
}

const capabilityByCategory: Record<string, string[]> = {
  MEDICAL: ["MEDICAL_FIRST_AID"],
  STRANDED: ["EVACUATION_ASSISTANCE", "TRANSPORT"],
  EVACUATION: ["EVACUATION_ASSISTANCE", "TRANSPORT"],
  TRANSPORTATION: ["TRANSPORT"],
  ELDERLY_ASSISTANCE: ["EVACUATION_ASSISTANCE", "GENERAL_ASSISTANCE"],
  DISABILITY_ASSISTANCE: ["EVACUATION_ASSISTANCE", "GENERAL_ASSISTANCE"],
  CHILD_FAMILY_ASSISTANCE: ["TRANSPORT", "GENERAL_ASSISTANCE"],
};
export function rankResponders(request: any, responders: any[]) {
  const required = capabilityByCategory[request.category] || [
    "GENERAL_ASSISTANCE",
  ];
  return responders
    .filter(
      (r) =>
        r.availability &&
        r.status === "AVAILABLE" &&
        r.verification_status === "VERIFIED",
    )
    .map((r) => {
      const capabilities: string[] =
        typeof r.capabilities === "string"
          ? JSON.parse(r.capabilities)
          : r.capabilities;
      const distanceKm = haversineKm(request, r);
      const capabilityMatches = required.filter((x) =>
        capabilities.includes(x),
      );
      const transportOk =
        request.category !== "TRANSPORTATION" ||
        (r.vehicle_available && r.passenger_capacity >= request.people_count);
      const score = Math.round(
        clamp(
          100 -
            distanceKm * 5 +
            capabilityMatches.length * 20 +
            (transportOk ? 5 : -30) +
            (r.reliability_score - 80) / 2,
        ),
      );
      return {
        responderId: r.id,
        userId: r.user_id,
        distanceKm: Number(distanceKm.toFixed(2)),
        score,
        suitable: capabilityMatches.length > 0 && transportOk,
        capabilityMatches,
        vehicleAvailable: !!r.vehicle_available,
        passengerCapacity: r.passenger_capacity,
        reasons: [
          `${distanceKm.toFixed(1)} km away`,
          capabilityMatches.length
            ? `Matches ${capabilityMatches.join(", ")}`
            : "No direct capability match",
          transportOk
            ? "Capacity requirements met"
            : "Insufficient transport capacity",
        ],
      };
    })
    .filter((x) => x.suitable)
    .sort((a, b) => b.score - a.score);
}

export const assignmentTransitions: Record<string, string[]> = {
  ASSIGNED: ["ACCEPTED", "REJECTED", "CANCELLED", "FAILED", "REASSIGNED"],
  ACCEPTED: ["EN_ROUTE", "CANCELLED", "FAILED", "REASSIGNED"],
  EN_ROUTE: ["ARRIVED", "FAILED", "REASSIGNED"],
  ARRIVED: ["ASSISTING", "FAILED"],
  ASSISTING: ["EVACUATED", "COMPLETED", "FAILED"],
  EVACUATED: ["SHELTER_CHECKIN", "SAFE", "COMPLETED"],
  SHELTER_CHECKIN: ["SAFE", "COMPLETED"],
  SAFE: ["CLOSED"],
  COMPLETED: ["CLOSED"],
  REJECTED: ["REASSIGNED"],
  FAILED: ["REASSIGNED"],
  REASSIGNED: [],
  CANCELLED: [],
  CLOSED: [],
};
export function assertTransition(from: string, to: string) {
  if (!assignmentTransitions[from]?.includes(to))
    throw Object.assign(
      new Error(`Invalid assignment transition: ${from} -> ${to}`),
      { status: 409 },
    );
}

export function escalationRecommendation(input: {
  severity: number;
  unresolved: number;
  responders: number;
  medical: number;
  delayMinutes: number;
  blockedRoutes: number;
  shelterUtilization: number;
}) {
  const reasons: string[] = [];
  if (input.severity >= 81) reasons.push("Critical incident severity");
  if (input.medical > 0) reasons.push("Unresolved medical emergencies");
  if (input.unresolved > Math.max(3, input.responders * 2))
    reasons.push("Responder capacity is insufficient");
  if (input.delayMinutes >= 30) reasons.push("Severe response delays");
  if (input.blockedRoutes >= 2) reasons.push("Multiple blocked routes");
  if (input.shelterUtilization >= 0.9)
    reasons.push("Shelter capacity shortage");
  const recommendedLevel =
    input.severity >= 90 || reasons.length >= 4
      ? "HIGHER_LEVEL_AUTHORIZED_RESPONSE"
      : input.severity >= 81 || reasons.length >= 3
        ? "EMERGENCY_MANAGEMENT"
        : input.medical || reasons.length >= 2
          ? "PROFESSIONAL_EMERGENCY_RESPONSE"
          : reasons.length
            ? "NGO_TRAINED_RESPONDERS"
            : "COMMUNITY";
  return { shouldEscalate: reasons.length > 0, recommendedLevel, reasons };
}
