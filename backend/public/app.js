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
  intelligence: { zones: [], fires: [], sources: {} },
  focusRequestId: null,
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
    "incident.created",
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
  ].forEach((event) =>
    socket.on(event, (payload = {}) => {
      addActivity(event);
      if (event === "help_request.created") {
        state.incidentId = payload.incident_id || state.incidentId;
        state.focusRequestId = payload.id;
        toast(
          `New ${pretty(payload.category || "help")} request · ${payload.people_count || 1} ${payload.people_count === 1 ? "person" : "people"}`,
        );
      }
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
  const privileged = ["COORDINATOR", "ADMIN"].includes(state.user.role);
  const tasks = [];
  if (privileged) {
    tasks.push(api("/responders").then((x) => (state.responders = x)));
    tasks.push(
      api("/intelligence")
        .then((x) => (state.intelligence = x))
        .catch(() => {
          state.intelligence = { zones: [], fires: [], sources: {} };
        }),
    );
  }
  if (state.user.role === "RESPONDER")
    tasks.push(api("/responders/me").then((x) => (state.responderProfile = x)));
  if (state.incidentId) {
    const query = "?incidentId=" + encodeURIComponent(state.incidentId);
    tasks.push(
      api("/shelters" + query).then((x) => (state.shelters = x)),
      api("/reports" + query).then((x) => (state.reports = x)),
    );
  } else {
    state.shelters = [];
    state.reports = [];
  }
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
  // Tear Leaflet down while its original container is still attached. Replacing
  // the container first leaves Leaflet holding a detached DOM node on refresh.
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  $("#operationalMap").innerHTML =
    `<div id="leafletMap" class="leaflet-map" aria-label="Interactive operational map"></div><div id="offlineMap" class="offline-map"><div class="map-empty-fallback"><span>⌖</span><h3>${incident ? escapeHtml(incident.name) : "Monitoring California"}</h3><p>${incident ? "Operational map is temporarily unavailable." : "No active operations. New resident requests will appear here automatically."}</p></div></div>`;
  renderLeafletMap(incident, points);
}
function renderLeafletMap(incident, points) {
  if (!window.L) {
    $("#mapMode").textContent = "Offline map · interactive tiles unavailable";
    return;
  }
  try {
    const center = incident
      ? [incident.latitude, incident.longitude]
      : [37.15, -119.7];
    const map = window.L.map("leafletMap", { zoomControl: false }).setView(
      center,
      incident ? 13 : 6,
    );
    state.map = map;
    window.L.control.zoom({ position: "bottomright" }).addTo(map);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    if (incident) {
      window.L.circle([incident.latitude, incident.longitude], {
        radius: incident.radius_km * 1600,
        color: "#e59b35",
        weight: 2,
        dashArray: "8 7",
        fillColor: "#f1b557",
        fillOpacity: 0.08,
      })
        .bindPopup(
          `<b>Alert radius</b><br>${incident.radius_km} km operational zone`,
        )
        .addTo(map);
      window.L.circle([incident.latitude, incident.longitude], {
        radius: incident.radius_km * 1000,
        color: "#c9322c",
        weight: 3,
        fillColor: "#e94a40",
        fillOpacity: 0.28,
      })
        .bindPopup(
          `<b>${escapeHtml(incident.name)}</b><br>${incident.severity_level} · ${incident.severity_score}/100`,
        )
        .bindTooltip(`${incident.radius_km} km operational radius`)
        .addTo(map);
    }
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
      if (point.kind === "help")
        marker.bindTooltip(
          `${escapeHtml(pretty(point.category))} · ${point.people_count} ${point.people_count === 1 ? "person" : "people"}`,
          { permanent: true, direction: "top", offset: [0, -8] },
        );
      marker.addTo(groups[names[point.kind]]);
      if (point.kind === "help")
        heat.push([
          point.latitude,
          point.longitude,
          Math.max(0.3, (point.priority_score || 50) / 100),
        ]);
    });
    if (window.L.heatLayer && heat.length) {
      try {
        groups["Risk heatmap"] = window.L.heatLayer(heat, {
          radius: 42,
          blur: 30,
          maxZoom: 17,
          gradient: { 0.2: "#ffd54a", 0.55: "#f58232", 1: "#d51f32" },
        });
      } catch (error) {
        console.warn("Request heatmap unavailable", error);
      }
    }
    const zoneColors = {
      normal: "#22c86a",
      advisory: "#f0ba20",
      warning: "#f47b20",
      order: "#ef3333",
      shelter: "#914bea",
      repopulation: "#3478df",
    };
    const zones = Array.isArray(state.intelligence.zones)
      ? state.intelligence.zones
      : [];
    if (zones.length) {
      groups["Evacuation zones"] = window.L.layerGroup();
      zones.forEach((zone) => {
        if (!zone.geom) return;
        try {
          window.L.geoJSON(zone.geom, {
            style: {
              color:
                zoneColors[String(zone.status || "normal").toLowerCase()] ||
                "#f47b20",
              weight: 2,
              fillOpacity: 0.16,
            },
          })
            .bindTooltip(escapeHtml(zone.name || zone.id || "Evacuation zone"))
            .addTo(groups["Evacuation zones"]);
        } catch (error) {
          console.warn("Skipped invalid evacuation zone", zone.id, error);
        }
      });
    }
    const fires = (
      Array.isArray(state.intelligence.fires) ? state.intelligence.fires : []
    ).filter(
      (fire) =>
        Number.isFinite(Number(fire.latitude)) &&
        Number.isFinite(Number(fire.longitude)),
    );
    if (fires.length) {
      groups["FIRMS hotspots"] = window.L.layerGroup();
      fires.forEach((fire) =>
        window.L.circleMarker([Number(fire.latitude), Number(fire.longitude)], {
          radius: 4,
          color: "#ff9e24",
          weight: 1,
          fillColor: "#ff4b1f",
          fillOpacity: 0.8,
        })
          .bindPopup(
            `<b>Satellite hotspot</b><br>FRP ${escapeHtml(String(fire.frp ?? "—"))}`,
          )
          .addTo(groups["FIRMS hotspots"]),
      );
      if (window.L.heatLayer) {
        try {
          groups["FIRMS fire heat"] = window.L.heatLayer(
            fires.map((fire) => [
              Number(fire.latitude),
              Number(fire.longitude),
              Math.min(1, Math.max(0.25, Math.sqrt(Number(fire.frp) || 1) / 8)),
            ]),
            {
              radius: 24,
              blur: 18,
              gradient: { 0.2: "#ffe65a", 0.55: "#ff8b21", 1: "#e52920" },
            },
          );
        } catch (error) {
          console.warn("FIRMS heatmap unavailable", error);
        }
      }
    }
    window.L.control
      .layers(null, groups, { collapsed: true, position: "topright" })
      .addTo(map);
    const bounds = window.L.latLngBounds(
      incident ? [[incident.latitude, incident.longitude]] : [],
    );
    points.forEach((p) => bounds.extend([p.latitude, p.longitude]));
    if (bounds.isValid()) {
      try {
        map.fitBounds(bounds.pad(0.28), { maxZoom: 14 });
      } catch {
        map.setView(center, incident ? 14 : 6);
      }
    }
    const focused = points.find((point) => point.id === state.focusRequestId);
    if (focused) {
      try {
        map.flyTo([focused.latitude, focused.longitude], 15);
      } catch {
        map.setView([focused.latitude, focused.longitude], 15);
      }
      state.focusRequestId = null;
    }
    $("#offlineMap").classList.add("hidden");
    $("#leafletMap").classList.add("ready");
    $("#mapMode").textContent = incident
      ? `Interactive OpenStreetMap · ${points.length} live field signals · ${fires.length} FIRMS hotspots`
      : `Monitoring California · waiting for resident requests · ${fires.length} FIRMS hotspots`;
    setTimeout(() => map.invalidateSize(), 50);
  } catch (error) {
    console.error("Operational map initialization failed", error);
    state.map = null;
    $("#mapMode").textContent =
      `Offline map · ${error?.message || "interactive map could not initialize"}`;
  }
}
function mapPopupDetail(point) {
  if (point.kind === "help")
    return `${pretty(point.priority_level)} priority · ${point.people_count} ${point.people_count === 1 ? "person" : "people"} · ${pretty(point.status)}${point.description ? `<br>${escapeHtml(point.description)}` : ""}`;
  if (point.kind === "responder")
    return `${point.availability ? "Available" : pretty(point.status)} · capacity ${point.passenger_capacity}`;
  if (point.kind === "shelter")
    return `${point.occupancy}/${point.capacity} occupied · ${pretty(point.status)}`;
  return `${pretty(point.verification_status || "unverified")} field report`;
}
function renderSeverityFactors() {
  const incident = state.incidents.find((x) => x.id === state.incidentId);
  if (!incident) {
    $("#severityBadge").textContent = "MONITORING";
    $("#severityBadge").className = "status neutral";
    $("#severityFactors").innerHTML =
      '<p class="muted">Severity factors will appear when the first help request creates an incident.</p>';
    $("#severityReasons").innerHTML = "";
    return;
  }
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
$("#residentHelpBtn").onclick = () => {
  go("requests");
  $("#requestForm").classList.remove("hidden");
};
$("#residentSafeBtn").onclick = () => safeCheckin(state.incidentId);
$("#availabilityBtn").onclick = toggleAvailability;
$("#reviewEscalationBtn").onclick = reviewEscalation;
if (state.token && state.user) showApp();
