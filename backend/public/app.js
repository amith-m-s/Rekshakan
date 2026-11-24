const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const state = {
  token: sessionStorage.getItem("rm_token"),
  user: JSON.parse(sessionStorage.getItem("rm_user") || "null"),
  incidents: [],
  incidentId: null,
  requests: [],
  assignments: [],
  shelters: [],
  reports: [],
  responders: [],
  responderProfile: null,
  map: null,
  socket: null,
};
const titles = {
  resident: "Resident safety",
  responder: "Responder operations",
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
  configureRole();
  connectSocket();
  await refreshAll();
}
function configureRole() {
  $$(".nav").forEach((button) => {
    const roles = (button.dataset.roles || "").split(",");
    button.classList.toggle("role-hidden", !roles.includes(state.user.role));
  });
  $("#newRequestBtn").classList.toggle(
    "hidden",
    state.user.role !== "RESIDENT",
  );
  go(
    state.user.role === "RESIDENT"
      ? "resident"
      : state.user.role === "RESPONDER"
        ? "responder"
        : "overview",
  );
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
    "help_request.priority_changed",
    "responder.status_changed",
    "responder.location_updated",
    "shelter.status_changed",
    "escalation.created",
    "intelligence.synced",
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
    await loadIncidents();
    const tasks = [
      loadRequests(),
      loadAssignments(),
      loadSimulator(),
      loadOperationalData(),
    ];
    if (["COORDINATOR", "ADMIN"].includes(state.user.role))
      tasks.push(loadDashboard());
    await Promise.all(tasks);
    if (!["COORDINATOR", "ADMIN"].includes(state.user.role))
      loadPersonalStats();
    renderRoleHome();
    renderActivity();
    if (showToast) toast("Data refreshed");
  } catch (e) {
    if (/token|access/i.test(e.message)) logout();
    else toast(e.message, true);
  }
}
async function loadOperationalData() {
  if (!state.incidentId) return;
  const query = "?incidentId=" + encodeURIComponent(state.incidentId);
  const tasks = [
    api("/shelters" + query).then((x) => (state.shelters = x)),
    api("/reports" + query).then((x) => (state.reports = x)),
  ];
  if (["COORDINATOR", "ADMIN"].includes(state.user.role))
    tasks.push(api("/responders").then((x) => (state.responders = x)));
  if (state.user.role === "RESPONDER")
    tasks.push(api("/responders/me").then((x) => (state.responderProfile = x)));
  await Promise.all(tasks);
}
function renderRoleHome() {
  if (state.user.role === "RESIDENT") renderResident();
  if (state.user.role === "RESPONDER") renderResponder();
  if (["COORDINATOR", "ADMIN"].includes(state.user.role)) {
    renderOperationalMap();
    renderSeverityFactors();
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
  if (state.user?.role === "RESPONDER") renderResponder();
}
function renderResident() {
  const incident = state.incidents.find((x) => x.id === state.incidentId);
  if (!incident) return;
  const critical = incident.severity_level === "CRITICAL";
  $("#residentAlert").innerHTML =
    `<span class="alert-icon">${critical ? "!" : "i"}</span><div><small>${escapeHtml(incident.disaster_type)} ALERT</small><h2>${escapeHtml(incident.name)}</h2><p>${incident.severity_level} risk · ${incident.radius_km} km affected radius</p></div>`;
  const request = state.requests[0];
  const steps = [
    "REQUESTED",
    "PRIORITIZED",
    "MATCHED",
    "ASSIGNED",
    "EN_ROUTE",
    "ARRIVED",
  ];
  const current = request ? Math.max(0, steps.indexOf(request.status)) : -1;
  $("#residentRequestStatus").innerHTML = request
    ? `<p class="eyebrow">YOUR REQUEST · ${short(request.id)}</p><h3>${pretty(request.status)}</h3><div class="status-track">${steps.map((step, index) => `<i class="${index <= current ? "done" : ""}" title="${pretty(step)}"></i>`).join("")}</div><p>${escapeHtml(request.description || "Assistance requested")}</p>`
    : '<p class="eyebrow">YOUR STATUS</p><h3>No active help request</h3><p class="muted">Use the SOS button if you need assistance.</p>';
  const shelter = state.shelters[0];
  $("#residentShelter").innerHTML = shelter
    ? `<span>⌂</span><div><small>NEARBY SHELTER</small><strong>${escapeHtml(shelter.name)}</strong><p>${shelter.capacity - shelter.occupancy} spaces available · ${shelter.accessibility ? "Accessible" : "Standard access"}</p></div>`
    : '<p class="muted">No shelter information available.</p>';
}
function missionButtons(assignment) {
  const next =
    {
      ASSIGNED: ["ACCEPTED", "REJECTED"],
      ACCEPTED: ["EN_ROUTE"],
      EN_ROUTE: ["ARRIVED"],
      ARRIVED: ["ASSISTING"],
      ASSISTING: ["EVACUATED"],
      EVACUATED: ["SAFE"],
      SAFE: ["CLOSED"],
    }[assignment.status] || [];
  return `<div class="row-actions">${next.map((x) => `<button class="secondary mission-transition" data-id="${assignment.id}" data-status="${x}">${pretty(x)}</button>`).join("")}</div>`;
}
function renderResponder() {
  const profile = state.responderProfile;
  if (!profile) return;
  $("#responderProfile").innerHTML =
    `<div class="profile-head"><span>${escapeHtml((profile.name || "R")[0])}</span><div><h3>${escapeHtml(profile.name || "Responder")}</h3><p><b class="verified">✓ VERIFIED</b> · ${profile.availability ? "Available" : "Unavailable"}</p></div></div><div class="capability-list">${(profile.capabilities || []).map((x) => `<span>${pretty(x)}</span>`).join("")}</div><div class="profile-meta"><div><small>VEHICLE</small><strong>${profile.vehicle_available ? "Available" : "None"}</strong></div><div><small>CAPACITY</small><strong>${profile.passenger_capacity}</strong></div><div><small>STATUS</small><strong>${pretty(profile.status)}</strong></div></div>`;
  $("#availabilityBtn").textContent = profile.availability
    ? "Go unavailable"
    : "Go available";
  const active = state.assignments.find(
    (a) => !["SAFE", "CLOSED", "REJECTED", "CANCELLED"].includes(a.status),
  );
  $("#activeMission").innerHTML = active
    ? `<span class="status high">${pretty(active.status)}</span><h2>Assist request ${short(active.request_id)}</h2><p>Follow the verified assignment lifecycle below. Location updates remain private to authorized roles.</p><div class="mission-actions">${missionButtons(active)}</div>`
    : '<div class="empty-mission"><span>✓</span><h3>Ready for assignment</h3><p class="muted">The matching engine will notify you when an eligible request is assigned.</p></div>';
  $("#responderAssignments").innerHTML = state.assignments.length
    ? `<table><thead><tr><th>REQUEST</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${state.assignments.map((a) => `<tr><td>${short(a.request_id)}</td><td><span class="status neutral">${pretty(a.status)}</span></td><td>${missionButtons(a)}</td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">No assignment history yet.</p>';
  $$(".mission-transition").forEach(
    (b) => (b.onclick = () => transition(b.dataset.id, b.dataset.status)),
  );
}
async function toggleAvailability() {
  const p = state.responderProfile;
  if (!p) return;
  try {
    await api("/responders/availability", {
      method: "POST",
      body: JSON.stringify({
        available: !p.availability,
        incidentId: state.incidentId,
        capabilities: p.capabilities,
        skills: p.skills,
        vehicleAvailable: p.vehicle_available,
        passengerCapacity: p.passenger_capacity,
        ...(p.latitude ? { latitude: p.latitude, longitude: p.longitude } : {}),
      }),
    });
    toast("Availability updated");
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}
function renderOperationalMap() {
  const incident = state.incidents.find((x) => x.id === state.incidentId);
  if (!incident) return;
  const points = [
    ...state.requests.map((x) => ({ ...x, kind: "help", label: x.category })),
    ...state.responders
      .filter((x) => x.latitude)
      .map((x) => ({ ...x, kind: "responder", label: x.name })),
    ...state.shelters.map((x) => ({ ...x, kind: "shelter", label: x.name })),
    ...state.reports
      .filter((x) => x.latitude && x.longitude)
      .map((x) => ({ ...x, kind: "report", label: pretty(x.category) })),
  ];
  const scale = Math.max(0.008, incident.radius_km / 75);
  const position = (p) => ({
    x: Math.max(
      25,
      Math.min(675, 350 + (p.longitude - incident.longitude) * (300 / scale)),
    ),
    y: Math.max(
      25,
      Math.min(355, 190 - (p.latitude - incident.latitude) * (155 / scale)),
    ),
  });
  const markers = points
    .map((p) => {
      const q = position(p);
      const shape =
        p.kind === "shelter"
          ? `<rect x="${q.x - 7}" y="${q.y - 7}" width="14" height="14" rx="3"/>`
          : p.kind === "report"
            ? `<path d="M${q.x - 7} ${q.y + 6}L${q.x} ${q.y - 7}L${q.x + 7} ${q.y + 6}Z"/>`
            : `<circle cx="${q.x}" cy="${q.y}" r="7"/>`;
      return `<g class="map-marker ${p.kind}"><title>${escapeHtml(p.label || p.kind)}</title>${shape}<text x="${q.x + 11}" y="${q.y + 4}">${escapeHtml(p.label || pretty(p.kind))}</text></g>`;
    })
    .join("");
  $("#operationalMap").innerHTML =
    `<div id="leafletMap" class="leaflet-map" aria-label="Interactive operational map"></div><div id="offlineMap" class="offline-map"><svg viewBox="0 0 700 380" role="img" aria-label="Offline operational map"><defs><pattern id="mapGrid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#cbd9d1" stroke-width="1"/></pattern><linearGradient id="terrain" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#edf4ef"/><stop offset="1" stop-color="#e2ebe5"/></linearGradient></defs><rect width="700" height="380" rx="14" fill="url(#terrain)"/><path d="M60 35L180 18l90 65 105-30 103 75 142-45 80 35V0H0v100Z" fill="#dce9df" opacity=".8"/><path d="M0 310l95-65 94 25 80-54 85 45 112-28 110 50 124-44v141H0Z" fill="#e7eee9"/><rect width="700" height="380" rx="14" fill="url(#mapGrid)" opacity=".55"/><path d="M30 260 C130 210 170 315 280 250 S430 175 520 230 S620 230 690 150" fill="none" stroke="#b9d5e7" stroke-width="14" opacity=".75"/><path d="M0 125 C120 95 190 170 300 135 S510 80 700 105" fill="none" stroke="#fff" stroke-width="5" opacity=".9"/><circle class="alert-radius" cx="350" cy="190" r="125"/><circle class="fire-radius" cx="350" cy="190" r="${35 + incident.severity_score / 3}"/><text class="fire-label" x="350" y="194">${incident.severity_score}</text>${markers}<g class="map-scale"><rect x="20" y="341" width="138" height="23" rx="7"/><text x="31" y="356">● LIVE · ${points.length} FIELD SIGNALS</text></g></svg></div>`;
  renderLeafletMap(incident, points);
}
function renderLeafletMap(incident, points) {
  if (!window.L) {
    $("#mapMode").textContent = "Offline map · interactive tiles unavailable";
    return;
  }
  try {
    if (state.map) state.map.remove();
    const map = window.L.map("leafletMap", { zoomControl: false }).setView(
      [incident.latitude, incident.longitude],
      13,
    );
    state.map = map;
    window.L.control.zoom({ position: "bottomright" }).addTo(map);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    const alertLayer = window.L.circle(
      [incident.latitude, incident.longitude],
      {
        radius: incident.radius_km * 1600,
        color: "#e59b35",
        weight: 2,
        dashArray: "8 7",
        fillColor: "#f1b557",
        fillOpacity: 0.08,
      },
    ).bindPopup(
      `<b>Alert radius</b><br>${incident.radius_km} km operational zone`,
    );
    const fireLayer = window.L.circle([incident.latitude, incident.longitude], {
      radius: incident.radius_km * 1000,
      color: "#c9322c",
      weight: 3,
      fillColor: "#e94a40",
      fillOpacity: 0.28,
    }).bindPopup(
      `<b>${escapeHtml(incident.name)}</b><br>${incident.severity_level} · ${incident.severity_score}/100`,
    );
    alertLayer.addTo(map);
    fireLayer.addTo(map);
    const groups = {
      Help: window.L.layerGroup().addTo(map),
      Responders: window.L.layerGroup().addTo(map),
      Shelters: window.L.layerGroup().addTo(map),
      Reports: window.L.layerGroup().addTo(map),
    };
    const heat = [];
    points.forEach((point) => {
      const colors = {
        help: point.priority_level === "CRITICAL" ? "#d5282e" : "#ec841d",
        responder: point.availability ? "#0b8b5b" : "#2877a6",
        shelter: "#2877a6",
        report: "#8450ad",
      };
      const names = {
        help: "Help",
        responder: "Responders",
        shelter: "Shelters",
        report: "Reports",
      };
      const marker = window.L.circleMarker([point.latitude, point.longitude], {
        radius: point.kind === "help" ? 9 : 7,
        color: "#fff",
        weight: 2,
        fillColor: colors[point.kind],
        fillOpacity: 1,
      });
      marker.bindPopup(
        `<b>${escapeHtml(point.label || pretty(point.kind))}</b><br>${mapPopupDetail(point)}`,
      );
      marker.addTo(groups[names[point.kind]]);
      if (point.kind === "help")
        heat.push([
          point.latitude,
          point.longitude,
          Math.max(0.3, (point.priority_score || 50) / 100),
        ]);
    });
    if (window.L.heatLayer && heat.length)
      groups["Risk heatmap"] = window.L.heatLayer(heat, {
        radius: 42,
        blur: 30,
        maxZoom: 17,
        gradient: { 0.2: "#ffd54a", 0.55: "#f58232", 1: "#d51f32" },
      }).addTo(map);
    window.L.control
      .layers(null, groups, { collapsed: true, position: "topright" })
      .addTo(map);
    const bounds = window.L.latLngBounds([
      [incident.latitude, incident.longitude],
    ]);
    points.forEach((p) => bounds.extend([p.latitude, p.longitude]));
    if (points.length) map.fitBounds(bounds.pad(0.28), { maxZoom: 14 });
    $("#offlineMap").classList.add("hidden");
    $("#leafletMap").classList.add("ready");
    $("#mapMode").textContent =
      `Interactive OpenStreetMap · ${points.length} live field signals`;
    setTimeout(() => map.invalidateSize(), 50);
  } catch (error) {
    state.map = null;
    $("#mapMode").textContent =
      "Offline map · interactive map could not initialize";
  }
}
function mapPopupDetail(point) {
  if (point.kind === "help")
    return `${pretty(point.priority_level)} priority · ${point.people_count} people · ${pretty(point.status)}`;
  if (point.kind === "responder")
    return `${point.availability ? "Available" : pretty(point.status)} · capacity ${point.passenger_capacity}`;
  if (point.kind === "shelter")
    return `${point.occupancy}/${point.capacity} occupied · ${pretty(point.status)}`;
  return `${pretty(point.verification_status || "unverified")} field report`;
}
function renderSeverityFactors() {
  const incident = state.incidents.find((x) => x.id === state.incidentId);
  if (!incident) return;
  const factors = Object.entries(incident.severity_factors || {});
  $("#severityBadge").textContent =
    `${incident.severity_level} · ${incident.severity_score}`;
  $("#severityBadge").className =
    `status ${incident.severity_level === "CRITICAL" ? "critical" : "high"}`;
  $("#severityFactors").innerHTML = factors.length
    ? factors
        .map(
          ([name, value]) =>
            `<div class="factor"><div><span>${pretty(name)}</span><strong>${value}</strong></div><div class="factor-bar"><i style="width:${Math.min(100, Number(value) || 0)}%"></i></div></div>`,
        )
        .join("")
    : '<p class="muted">Factors update as verified field signals arrive.</p>';
  $("#severityReasons").innerHTML = (incident.severity_reasons || [])
    .map((reason) => `<p>↳ ${escapeHtml(reason)}</p>`)
    .join("");
}
async function reviewEscalation() {
  try {
    const result = await api("/escalations/recommend/" + state.incidentId);
    $("#escalationRecommendation").innerHTML =
      `<div class="recommendation"><span class="status ${result.shouldEscalate ? "critical" : "active"}">${result.shouldEscalate ? "RECOMMENDED" : "MONITOR"}</span><h3>${pretty(result.recommendedLevel || "community")}</h3><p>${(result.reasons || []).map(escapeHtml).join(" · ") || "Current response capacity is sufficient."}</p><small>This is decision support only. A coordinator must authorize any escalation.</small>${result.shouldEscalate ? '<button id="createEscalationBtn" class="danger">Create authorization request</button>' : ""}</div>`;
    if ($("#createEscalationBtn"))
      $("#createEscalationBtn").onclick = () => createEscalation(result);
  } catch (e) {
    toast(e.message, true);
  }
}
async function createEscalation(result) {
  try {
    await api("/escalations", {
      method: "POST",
      body: JSON.stringify({
        incidentId: state.incidentId,
        reason: (result.reasons || ["Automated threshold recommendation"]).join(
          "; ",
        ),
        recommendedLevel: result.recommendedLevel,
      }),
    });
    toast("Authorization request created");
    await refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
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
    const lat = $("#simLat").value.trim();
    const lng = $("#simLng").value.trim();
    await api("/simulator/start", {
      method: "POST",
      body: JSON.stringify({
        // Blank coordinates: the server places the drill beside the most severe real California incident.
        ...(lat && lng ? { latitude: Number(lat), longitude: Number(lng) } : {}),
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
$("#residentHelpBtn").onclick = () => {
  go("requests");
  $("#requestForm").classList.remove("hidden");
};
$("#residentSafeBtn").onclick = () => safeCheckin(state.incidentId);
$("#availabilityBtn").onclick = toggleAvailability;
$("#reviewEscalationBtn").onclick = reviewEscalation;
if (state.token && state.user) showApp();
