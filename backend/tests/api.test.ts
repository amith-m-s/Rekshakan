import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seed } from "../src/seed/index.js";
const app = createApp();
let resident = "",
  coordinator = "",
  responder = "",
  admin = "",
  resident2 = "";
async function login(email: string) {
  return (
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: "Demo123!" })
  ).body.data.accessToken;
}
beforeAll(async () => {
  await seed();
  resident = await login("resident@rescuermap.local");
  coordinator = await login("coordinator@rescuermap.local");
  responder = await login("responder@rescuermap.local");
  admin = await login("admin@rescuermap.local");
  resident2 = await login("resident2@rescuermap.local");
});
describe("API rescue workflow", () => {
  it("serves the local test console", async () => {
    const page = await request(app).get("/");
    expect(page.status).toBe(200);
    expect(page.text).toContain("RescuerMap Test Console");
    expect(page.text).toContain("RESIDENT SAFETY");
    expect(page.text).toContain("Responder operations");
    expect(page.text).toContain("Operational map");
    expect(page.text).toContain("leaflet@1.9.4");
    expect(page.text).toContain("leaflet.heat@0.2.0");
    expect(page.headers["content-security-policy"]).toContain(
      "https://*.tile.openstreetmap.org",
    );
  });
  it("uses one trusted proxy hop in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const productionApp = createApp();
    expect(productionApp.get("trust proxy fn")("127.0.0.1", 0)).toBe(true);
    expect(productionApp.get("trust proxy fn")("127.0.0.1", 1)).toBe(false);
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  it("returns a responder-scoped profile with latest location", async () => {
    const own = await request(app)
      .get("/api/responders/me")
      .set("Authorization", `Bearer ${responder}`);
    expect(own.status).toBe(200);
    expect(own.body.data.user_id).toBe("usr_responder");
    expect(own.body.data.latitude).toBeTypeOf("number");
    expect(own.body.data.capabilities).toContain("MEDICAL_FIRST_AID");
    const denied = await request(app)
      .get("/api/responders/me")
      .set("Authorization", `Bearer ${resident}`);
    expect(denied.status).toBe(403);
  });
  it("protects coordinator resources", async () => {
    expect(
      (
        await request(app)
          .get("/api/admin/dashboard")
          .set("Authorization", `Bearer ${resident}`)
      ).status,
    ).toBe(403);
  });
  it("runs need-help through transactional shelter, safe, and closure", async () => {
    const severityBefore = (
      await request(app)
        .get("/api/incidents/inc_demo/severity")
        .set("Authorization", `Bearer ${coordinator}`)
    ).body.data.score;
    const created = await request(app)
      .post("/api/help-requests")
      .set("Authorization", `Bearer ${resident}`)
      .send({
        clientRequestId: "test-happy-path",
        incidentId: "inc_demo",
        latitude: 12.892,
        longitude: 77.602,
        category: "MEDICAL",
        description: "Test emergency",
        peopleCount: 1,
        medicalEmergency: true,
        vulnerabilities: ["ELDERLY"],
        immediateDanger: true,
      });
    expect(created.status).toBe(201);
    const requestId = created.body.data.id;
    expect(created.body.data.priority_score).toBeGreaterThan(50);
    const severityAfter = (
      await request(app)
        .get("/api/incidents/inc_demo/severity")
        .set("Authorization", `Bearer ${coordinator}`)
    ).body.data.score;
    expect(severityAfter).toBeGreaterThan(severityBefore);
    const duplicate = await request(app)
      .post("/api/help-requests")
      .set("Authorization", `Bearer ${resident}`)
      .send({
        clientRequestId: "test-happy-path",
        incidentId: "inc_demo",
        latitude: 12.892,
        longitude: 77.602,
        category: "MEDICAL",
        peopleCount: 1,
        medicalEmergency: true,
        vulnerabilities: [],
        immediateDanger: true,
      });
    expect(duplicate.body.data.id).toBe(requestId);
    const matches = await request(app)
      .get(`/api/matches/${requestId}`)
      .set("Authorization", `Bearer ${coordinator}`);
    expect(matches.body.data.length).toBeGreaterThan(0);
    const assigned = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${coordinator}`)
      .send({ requestId, responderId: "rsp_demo" });
    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.data.id;
    for (const status of [
      "ACCEPTED",
      "EN_ROUTE",
      "ARRIVED",
      "ASSISTING",
      "EVACUATED",
    ]) {
      const changed = await request(app)
        .post(`/api/assignments/${assignmentId}/transition`)
        .set("Authorization", `Bearer ${responder}`)
        .send({ status });
      expect(changed.status, `${status}: ${JSON.stringify(changed.body)}`).toBe(
        200,
      );
    }
    const before = (
      await request(app)
        .get("/api/shelters?incidentId=inc_demo")
        .set("Authorization", `Bearer ${coordinator}`)
    ).body.data[0].occupancy;
    const checkin = await request(app)
      .post("/api/shelters/shl_demo/checkins")
      .set("Authorization", `Bearer ${responder}`)
      .send({ userId: "usr_resident", requestId, peopleCount: 1 });
    expect(checkin.status).toBe(201);
    const repeat = await request(app)
      .post("/api/shelters/shl_demo/checkins")
      .set("Authorization", `Bearer ${responder}`)
      .send({ userId: "usr_resident", requestId, peopleCount: 1 });
    expect(repeat.status).toBe(200);
    const after = (
      await request(app)
        .get("/api/shelters?incidentId=inc_demo")
        .set("Authorization", `Bearer ${coordinator}`)
    ).body.data[0].occupancy;
    expect(after).toBe(before + 1);
    for (const status of ["SAFE", "CLOSED"]) {
      const changed = await request(app)
        .post(`/api/assignments/${assignmentId}/transition`)
        .set(
          "Authorization",
          `Bearer ${status === "CLOSED" ? coordinator : responder}`,
        )
        .send({ status });
      expect(changed.status).toBe(200);
    }
    const timeline = await request(app)
      .get(`/api/audit/timeline/${requestId}`)
      .set("Authorization", `Bearer ${coordinator}`);
    expect(timeline.body.data.map((x: any) => x.action)).toEqual(
      expect.arrayContaining([
        "HELP_REQUEST_CREATED",
        "RESPONDER_ASSIGNED",
        "ASSIGNMENT_ACCEPTED",
        "RESPONDER_EN_ROUTE",
        "RESPONDER_ARRIVED",
        "PERSON_EVACUATED",
        "SHELTER_CHECKIN",
        "PERSON_SAFE",
        "CASE_CLOSED",
      ]),
    );
  });
  it("keeps user and responder verification synchronized", async () => {
    const registration = await request(app).post("/api/auth/register").send({
      email: "new-responder@rescuermap.local",
      password: "Demo123!",
      name: "New Responder",
      role: "RESPONDER",
    });
    expect(registration.status).toBe(201);
    await request(app)
      .patch(`/api/users/${registration.body.data.id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ verificationStatus: "VERIFIED" })
      .expect(200);
    const responders = (
      await request(app)
        .get("/api/responders")
        .set("Authorization", `Bearer ${admin}`)
    ).body.data;
    expect(
      responders.find((x: any) => x.user_id === registration.body.data.id)
        .verification_status,
    ).toBe("VERIFIED");
  });
  it("keeps an active rescue open when a resident independently reports safe", async () => {
    const created = await request(app)
      .post("/api/help-requests")
      .set("Authorization", `Bearer ${resident2}`)
      .send({
        clientRequestId: "safe-during-assignment",
        incidentId: "inc_demo",
        latitude: 12.9,
        longitude: 77.61,
        category: "EVACUATION",
        peopleCount: 1,
        medicalEmergency: false,
        vulnerabilities: [],
        immediateDanger: true,
      });
    const assigned = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${coordinator}`)
      .send({ requestId: created.body.data.id, responderId: "rsp_demo2" });
    const checkin = await request(app)
      .post("/api/safe-checkins")
      .set("Authorization", `Bearer ${resident2}`)
      .send({ incidentId: "inc_demo", source: "SELF" });
    expect(checkin.body.data.activeAssignmentsUnchanged).toContain(
      assigned.body.data.id,
    );
    const assignments = await request(app)
      .get("/api/assignments")
      .set("Authorization", `Bearer ${coordinator}`);
    expect(
      assignments.body.data.find(
        (item: any) => item.id === assigned.body.data.id,
      ).status,
    ).toBe("ASSIGNED");
    const help = await request(app)
      .get(`/api/help-requests/${created.body.data.id}`)
      .set("Authorization", `Bearer ${coordinator}`);
    expect(help.body.data.status).toBe("ASSIGNED");
    const reassigned = await request(app)
      .post(`/api/assignments/${assigned.body.data.id}/reassign`)
      .set("Authorization", `Bearer ${coordinator}`)
      .send({ responderId: "rsp_demo", reason: "Coverage handoff" });
    expect(reassigned.status).toBe(201);
    const afterReassignment = await request(app)
      .get("/api/assignments")
      .set("Authorization", `Bearer ${coordinator}`);
    expect(
      afterReassignment.body.data.find(
        (item: any) => item.id === assigned.body.data.id,
      ).status,
    ).toBe("REASSIGNED");
    expect(
      afterReassignment.body.data.find(
        (item: any) => item.id === reassigned.body.data.id,
      ).status,
    ).toBe("ASSIGNED");
  });
  it("drives the provider-backed simulator", async () => {
    const started = await request(app)
      .post("/api/simulator/start")
      .set("Authorization", `Bearer ${coordinator}`)
      .send({ responders: 1, reports: 1 });
    expect(started.status).toBe(201);
    const critical = await request(app)
      .post("/api/simulator/control")
      .set("Authorization", `Bearer ${coordinator}`)
      .send({ action: "TRIGGER_CRITICAL_STATE" });
    expect(critical.status).toBe(200);
    const incident = await request(app)
      .get(`/api/incidents/${started.body.data.incidentId}`)
      .set("Authorization", `Bearer ${coordinator}`);
    expect(incident.body.data.severity_level).toBe("CRITICAL");
  });
});
