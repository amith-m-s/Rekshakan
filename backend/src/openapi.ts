const operations = [
  ["post", "/auth/register"],
  ["post", "/auth/login"],
  ["post", "/auth/logout"],
  ["get", "/users/me"],
  ["patch", "/users/{id}"],
  ["get", "/users"],
  ["post", "/locations"],
  ["get", "/locations/users/{userId}/latest"],
  ["get", "/locations/users/{userId}/history"],
  ["get", "/incidents"],
  ["post", "/incidents"],
  ["get", "/incidents/{id}"],
  ["patch", "/incidents/{id}"],
  ["get", "/incidents/{id}/severity"],
  ["post", "/incidents/{id}/severity/recalculate"],
  ["post", "/help-requests"],
  ["get", "/help-requests"],
  ["get", "/help-requests/{id}"],
  ["post", "/help-requests/{id}/cancel"],
  ["post", "/safe-checkins"],
  ["post", "/responders/availability"],
  ["get", "/responders/me"],
  ["get", "/public/incidents"],
  ["get", "/intelligence/status"],
  ["post", "/intelligence/sync"],
  ["get", "/responders"],
  ["get", "/matches/{requestId}"],
  ["post", "/assignments"],
  ["get", "/assignments"],
  ["post", "/assignments/{id}/transition"],
  ["post", "/assignments/{id}/reassign"],
  ["post", "/shelters"],
  ["get", "/shelters"],
  ["post", "/shelters/{id}/checkins"],
  ["post", "/reports"],
  ["get", "/reports"],
  ["patch", "/reports/{id}/verification"],
  ["get", "/alerts"],
  ["post", "/alerts/incidents/{id}/generate"],
  ["post", "/alerts/{id}/read"],
  ["get", "/escalations/recommend/{incidentId}"],
  ["post", "/escalations"],
  ["post", "/escalations/{id}/approve"],
  ["get", "/escalations"],
  ["post", "/fraud/scan/{userId}"],
  ["get", "/fraud"],
  ["patch", "/fraud/{id}"],
  ["get", "/audit"],
  ["get", "/audit/timeline/{requestId}"],
  ["get", "/analytics/incidents/{id}"],
  ["get", "/admin/dashboard"],
  ["get", "/providers/status"],
  ["get", "/providers/geocode"],
  ["get", "/providers/roads"],
  ["post", "/providers/alert-draft"],
  ["post", "/simulator/start"],
  ["post", "/simulator/control"],
  ["get", "/simulator"],
  ["get", "/health"],
] as const;

const publicOperations = new Set([
  "post /auth/register",
  "post /auth/login",
  "get /health",
]);
const paths: Record<string, any> = {};
for (const [method, path] of operations) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  paths[path] ||= {};
  paths[path][method] = {
    tags: [path.split("/")[1] || "system"],
    summary: `${method.toUpperCase()} ${path}`,
    ...(publicOperations.has(`${method} ${path}`) ? { security: [] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(["post", "patch"].includes(method)
      ? {
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
        }
      : {}),
    responses: {
      "200": { description: "Successful response" },
      "201": { description: "Resource created" },
      "400": { description: "Validation error" },
      "401": { description: "Authentication required" },
      "403": { description: "Insufficient permission" },
    },
  };
}

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "RescuerMap API",
    version: "1.1.0",
    description:
      "Human-authorized disaster assistance coordination API. Escalations and AI alert drafts always require authorized human approval.",
  },
  servers: [{ url: "http://localhost:4000/api" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ApiError: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths,
};
