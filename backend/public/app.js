const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const state = {
  token: sessionStorage.getItem("rm_token"),
  user: JSON.parse(sessionStorage.getItem("rm_user") || "null"),
  incidents: [],
  incidentId: null,
  requests: [],
  assignments: [],
  socket: null,
};
const titles = {
  overview: "Operational overview",
  requests: "Help requests",
  assignments: "Assignments",
  simulator: "Wildfire simulator",
  timeline: "Rescue timeline",
};
function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = bad ? "#9f3029" : "#142b23";
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: "Bearer " + state.token } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload.error?.message || `Request failed (${response.status})`,
    );
  return payload.data;
}
async function login() {
  try {
    $("#loginError").textContent = "";
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#accountSelect").value,
        password: $("#password").value,
      }),
    });
    state.token = data.accessToken;
    state.user = data.user;
    sessionStorage.setItem("rm_token", state.token);
    sessionStorage.setItem("rm_user", JSON.stringify(state.user));
    showApp();
  } catch (e) {
    $("#loginError").textContent = e.message;
  }
}
function logout() {
  sessionStorage.clear();
  state.socket?.close();
  state.token = null;
  state.user = null;
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}
async function showApp() {
  if (!state.token) return;
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userName").textContent = state.user.name;
  $("#userRole").textContent = state.user.role;
  $("#userInitial").textContent = state.user.name[0];
  connectSocket();
  await refreshAll();
}
function connectSocket() {
  state.socket?.close();
  const socket = io({ auth: { token: state.token } });
  state.socket = socket;
  socket.on("connect", () => {
    $("#socketState").classList.add("online");
    $("#socketState").lastChild.textContent = " Live updates";
  });
  socket.on("disconnect", () => {
    $("#socketState").classList.remove("online");
    $("#socketState").lastChild.textContent = " Disconnected";
  });
  [
    "help_request.created",
    "assignment.created",
    "assignment.status_changed",
    "incident.severity_changed",
    "person.safe",
    "simulator.updated",
  ].forEach((event) =>
    socket.on(event, () => {
      addActivity(event);
      refreshAll(false);
    }),
  );
}
function addActivity(event) {
  const list = JSON.parse(sessionStorage.getItem("rm_activity") || "[]");
  list.unshift({ event, time: new Date().toLocaleTimeString() });
  sessionStorage.setItem("rm_activity", JSON.stringify(list.slice(0, 8)));
  renderActivity();
}
function renderActivity() {
  const list = JSON.parse(sessionStorage.getItem("rm_activity") || "[]");
  $("#activity").innerHTML = list.length
    ? list
        .map(
          (x) =>
            `<div class="activity-item"><i></i><div><strong>${pretty(x.event)}</strong><small>${x.time}</small></div></div>`,
        )
        .join("")
    : '<p class="muted">Live events will appear here.</p>';
}
async function refreshAll(showToast = false) {
  try {
    const tasks = [
      loadIncidents(),
      loadRequests(),
      loadAssignments(),
      loadSimulator(),
    ];
    if (["COORDINATOR", "ADMIN"].includes(state.user.role))
      tasks.push(loadDashboard());
    else loadPersonalStats();
    await Promise.all(tasks);
    renderActivity();
    if (showToast) toast("Data refreshed");
  } catch (e) {
    if (/token|access/i.test(e.message)) logout();
    else toast(e.message, true);
  }
}
async function loadDashboard() {
  const d = await api("/admin/dashboard");
  renderStats([
    { label: "Active incidents", value: d.activeIncidents },
    { label: "Need assistance", value: d.peopleNeedingHelp },
    { label: "Active responders", value: d.activeResponders },
    { label: "Critical requests", value: d.criticalRequests },
  ]);
}
function loadPersonalStats() {
  renderStats([
    { label: "Role", value: state.user.role },
    {
      label: "Active incidents",
      value: state.incidents.filter((x) =>
        ["ACTIVE", "DETECTED"].includes(x.status),
      ).length,
    },
    { label: "My requests", value: state.requests.length },
    { label: "Assignments", value: state.assignments.length },
  ]);
}
function renderStats(items) {
  $("#stats").innerHTML = items
    .map(
      (x) =>
        `<div class="stat"><span>${x.label}</span><strong>${x.value}</strong></div>`,
    )
    .join("");
}
async function loadIncidents() {
  state.incidents = await api("/incidents");
  if (
    !state.incidentId ||
    !state.incidents.some((x) => x.id === state.incidentId)
  )
    state.incidentId = state.incidents[0]?.id;
  $("#incidentSelect").innerHTML = state.incidents
    .map(
      (x) =>
        `<option value="${x.id}" ${x.id === state.incidentId ? "selected" : ""}>${escapeHtml(x.name)}</option>`,
    )
    .join("");
  renderIncident();
}
function renderIncident() {
  const x = state.incidents.find((i) => i.id === state.incidentId);
  if (!x) {
    $("#incidentCard").innerHTML = '<p class="muted">No active incidents.</p>';
    return;
  }
  const cls =
    x.severity_level === "CRITICAL"
      ? "critical"
      : x.severity_score > 40
        ? "high"
        : "active";
  $("#incidentCard").innerHTML =
    `<div class="incident-title"><i class="incident-dot"></i><div><h3>${escapeHtml(x.name)}</h3><span class="status ${cls}">${x.status}</span></div></div><div class="severity-row"><div class="severity-score"><small>Severity score</small><br><strong>${x.severity_score}</strong><small>/100</small></div><span class="status ${cls}">${x.severity_level}</span></div><div class="meter"><i style="width:${x.severity_score}%"></i></div><div class="meta-row"><div><small>TYPE</small><strong>${x.disaster_type}</strong></div><div><small>RADIUS</small><strong>${x.radius_km} km</strong></div><div><small>SPREAD</small><strong>${x.spread_speed ?? "—"} km/h</strong></div></div><p class="fine">${(x.severity_reasons || []).slice(0, 2).join(" · ") || "Awaiting severity signals"}</p>`;
}
async function loadRequests() {
  state.requests = await api(
    "/help-requests" +
      (state.incidentId && ["COORDINATOR", "ADMIN"].includes(state.user.role)
        ? "?incidentId=" + state.incidentId
        : ""),
  );
  renderRequests();
  $("#timelineRequest").innerHTML =
    '<option value="">Select request</option>' +
    state.requests
      .map(
        (x) =>
          `<option value="${x.id}">${short(x.id)} · ${x.category}</option>`,
      )
      .join("");
}
function requestRows(rows) {
  return `<table><thead><tr><th>REQUEST</th><th>CATEGORY</th><th>PEOPLE</th><th>PRIORITY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${short(x.id)}</td><td>${pretty(x.category)}</td><td>${x.people_count}</td><td><span class="status ${x.priority_level === "CRITICAL" ? "critical" : "high"}">${x.priority_level} · ${x.priority_score}</span></td><td><span class="status neutral">${pretty(x.status)}</span></td><td><div class="row-actions">${["COORDINATOR", "ADMIN"].includes(state.user.role) && ["REQUESTED", "PRIORITIZED", "REASSIGNED"].includes(x.status) ? `<button class="secondary match-btn" data-id="${x.id}">Match</button>` : ""}${x.resident_id === state.user.id ? `<button class="secondary safe-btn" data-id="${x.incident_id}">I'm safe</button>` : ""}</div></td></tr>`).join("")}</tbody></table>`;
}
function renderRequests() {
  const content = state.requests.length
    ? requestRows(state.requests)
    : '<p class="muted">No help requests found.</p>';
  $("#requestsTable").innerHTML = content;
  $("#requestPreview").innerHTML = state.requests.length
    ? requestRows(state.requests.slice(0, 4))
    : '<p class="muted">No active requests.</p>';
  $$(".match-btn").forEach(
    (b) => (b.onclick = () => showMatches(b.dataset.id)),
  );
  $$(".safe-btn").forEach((b) => (b.onclick = () => safeCheckin(b.dataset.id)));
}
async function loadAssignments() {
  state.assignments = await api("/assignments");
  const transitions = {
    ASSIGNED: ["ACCEPTED", "REJECTED"],
    ACCEPTED: ["EN_ROUTE"],
    EN_ROUTE: ["ARRIVED"],
    ARRIVED: ["ASSISTING"],
    ASSISTING: ["EVACUATED"],
    EVACUATED: ["SAFE"],
    SHELTER_CHECKIN: ["SAFE"],
    SAFE: ["CLOSED"],
  };
  $("#assignmentsTable").innerHTML = state.assignments.length
    ? `<table><thead><tr><th>ASSIGNMENT</th><th>REQUEST</th><th>STATUS</th><th>NEXT STEP</th></tr></thead><tbody>${state.assignments.map((a) => `<tr><td>${short(a.id)}</td><td>${short(a.request_id)}</td><td><span class="status neutral">${pretty(a.status)}</span></td><td><div class="row-actions">${(transitions[a.status] || []).map((s) => `<button class="secondary transition-btn" data-id="${a.id}" data-status="${s}">${pretty(s)}</button>`).join("")}</div></td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">No assignments found.</p>';
  $$(".transition-btn").forEach(
    (b) => (b.onclick = () => transition(b.dataset.id, b.dataset.status)),
  );
}
async function showMatches(requestId) {
  try {
    const matches = await api("/matches/" + requestId);
    $("#matchCard").classList.remove("hidden");
    $("#matchResults").innerHTML = matches.length
      ? matches
          .map(
            (m) =>
              `<div class="match"><div><strong>${short(m.responderId)}</strong><p>${m.distanceKm} km away · score ${m.score} · capacity ${m.passengerCapacity}</p></div><button class="primary assign-btn" data-request="${requestId}" data-responder="${m.responderId}">Assign</button></div>`,
          )
          .join("")
      : '<p class="muted">No eligible responders available.</p>';
    $$(".assign-btn").forEach(
      (b) => (b.onclick = () => assign(b.dataset.request, b.dataset.responder)),
    );
  } catch (e) {
    toast(e.message, true);
  }
}
async function assign(requestId, responderId) {
  try {
    await api("/assignments", {
      method: "POST",
      body: JSON.stringify({ requestId, responderId }),
    });
    $("#matchCard").classList.add("hidden");
    toast("Responder assigned");
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
async function transition(id, status) {
  try {
    await api(`/assignments/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    toast("Assignment moved to " + pretty(status));
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
async function createRequest() {
  try {
    const inc = state.incidents.find((x) => x.id === state.incidentId);
    if (!inc) throw new Error("Start or select an incident first");
    await api("/help-requests", {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: "ui-" + Date.now(),
        incidentId: inc.id,
        latitude: inc.latitude + 0.002,
        longitude: inc.longitude + 0.002,
        category: $("#requestCategory").value,
        description: $("#requestDescription").value,
        peopleCount: Number($("#peopleCount").value),
        medicalEmergency: $("#medicalFlag").checked,
        vulnerabilities: [],
        immediateDanger: $("#dangerFlag").checked,
      }),
    });
    $("#requestForm").classList.add("hidden");
    toast("Help request created");
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
async function safeCheckin(incidentId) {
  try {
    await api("/safe-checkins", {
      method: "POST",
      body: JSON.stringify({ incidentId, source: "SELF" }),
    });
    toast("Safe check-in recorded");
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
async function loadSimulator() {
  if (!["COORDINATOR", "ADMIN"].includes(state.user.role)) {
    return;
  }
  try {
    const s = await api("/simulator");
    $("#simStatus").textContent = s.status;
    $("#simStatus").className =
      "status " + (s.status === "RUNNING" ? "active" : "neutral");
  } catch {}
}
async function startSimulator() {
  try {
    await api("/simulator/start", {
      method: "POST",
      body: JSON.stringify({
        latitude: Number($("#simLat").value),
        longitude: Number($("#simLng").value),
        severity: Number($("#simSeverity").value),
        responders: Number($("#simResponders").value),
        reports: 3,
      }),
    });
    toast("Wildfire simulation started");
    await refreshAll();
    go("overview");
  } catch (e) {
    toast(e.message, true);
  }
}
async function controlSimulator(action) {
  try {
    await api("/simulator/control", {
      method: "POST",
      body: JSON.stringify({ action, count: 3, amount: 10 }),
    });
    toast(pretty(action));
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
async function loadTimeline() {
  const id = $("#timelineRequest").value;
  if (!id) {
    $("#timelineEvents").innerHTML =
      '<p class="muted">Choose a request to view its history.</p>';
    return;
  }
  try {
    const events = await api("/audit/timeline/" + id);
    $("#timelineEvents").innerHTML = events
      .map(
        (e) =>
          `<div class="event"><strong>${pretty(e.action)}</strong><small>${new Date(e.created_at).toLocaleString()}${e.new_state ? " · " + pretty(e.new_state) : ""}</small></div>`,
      )
      .join("");
  } catch (e) {
    toast(e.message, true);
  }
}
function go(target) {
  $$(".panel-view").forEach((x) =>
    x.classList.toggle("hidden", x.id !== target),
  );
  $$(".nav").forEach((x) =>
    x.classList.toggle("active", x.dataset.target === target),
  );
  $("#pageTitle").textContent = titles[target] || "Test console";
}
function pretty(s = "") {
  return s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^| )\w/g, (c) => c.toUpperCase());
}
function short(s = "") {
  return s.length > 18 ? s.slice(0, 8) + "…" + s.slice(-5) : s;
}
function escapeHtml(s = "") {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}
$("#loginBtn").onclick = login;
$("#logoutBtn").onclick = logout;
$("#refreshBtn").onclick = () => refreshAll(true);
$("#incidentSelect").onchange = (e) => {
  state.incidentId = e.target.value;
  renderIncident();
  refreshAll();
};
$$(".nav").forEach((b) => (b.onclick = () => go(b.dataset.target)));
$$(".link-nav").forEach((b) => (b.onclick = () => go(b.dataset.go)));
$("#newRequestBtn").onclick = () =>
  $("#requestForm").classList.remove("hidden");
$("#cancelRequestBtn").onclick = () =>
  $("#requestForm").classList.add("hidden");
$("#submitRequestBtn").onclick = createRequest;
$("#closeMatches").onclick = () => $("#matchCard").classList.add("hidden");
$("#startSimBtn").onclick = startSimulator;
$$("[data-action]").forEach(
  (b) => (b.onclick = () => controlSimulator(b.dataset.action)),
);
$("#timelineRequest").onchange = loadTimeline;
if (state.token && state.user) showApp();
