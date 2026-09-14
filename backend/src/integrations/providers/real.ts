import { config } from "../../config/index.js";

async function checkedFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(config.providerTimeoutMs),
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}`);
  return response;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "",
    quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += char;
  }
  values.push(value);
  return values;
}

export const realProviders = {
  disaster: {
    async fetchIncident(bbox = "-123,36.5,-121,38") {
      if (!process.env.NASA_API_KEY)
        throw new Error("NASA_API_KEY is not configured");
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(process.env.NASA_API_KEY)}/VIIRS_SNPP_NRT/${encodeURIComponent(bbox)}/2`;
      const csv = await checkedFetch(url).then((response) => response.text());
      const [header, ...lines] = csv.trim().split(/\r?\n/);
      if (!header) throw new Error("NASA FIRMS returned an empty dataset");
      const columns = parseCsvLine(header);
      const fires = lines
        .filter(Boolean)
        .map((line) =>
          Object.fromEntries(
            parseCsvLine(line).map((value, index) => [columns[index], value]),
          ),
        );
      return { bbox, fires };
    },
  },
  weather: {
    async fetchWeather(latitude: number, longitude: number) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m`;
      const data: any = await checkedFetch(url).then((response) =>
        response.json(),
      );
      return {
        windSpeed: data.current?.wind_speed_10m,
        windDirection: data.current?.wind_direction_10m,
        temperature: data.current?.temperature_2m,
        humidity: data.current?.relative_humidity_2m,
      };
    },
  },
  roads: {
    async fetchRoads(from?: string, to?: string) {
      if (
        !from ||
        !to ||
        !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(from) ||
        !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(to)
      )
        return [];
      const data: any = await checkedFetch(
        `https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`,
      ).then((response) => response.json());
      if (data.code !== "Ok" || !data.routes?.length)
        throw new Error(data.message || "OSRM returned no route");
      return [data.routes[0]];
    },
  },
  geocoding: {
    async geocode(query: string) {
      const userAgent = process.env.NOMINATIM_USER_AGENT;
      if (!userAgent || userAgent.includes("contact@example.com"))
        throw new Error(
          "NOMINATIM_USER_AGENT must contain a real contact address",
        );
      const results: any[] = (await checkedFetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { headers: { "User-Agent": userAgent } },
      ).then((response) => response.json())) as any[];
      if (!results.length) throw new Error("No geocoding result");
      return {
        latitude: Number(results[0].lat),
        longitude: Number(results[0].lon),
      };
    },
  },
  ai: {
    async analyze(payload: unknown) {
      const apiKey = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
      const response: any = await checkedFetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
            messages: [
              {
                role: "system",
                content:
                  "Draft a concise disaster alert. Label it as a draft requiring authorized coordinator approval. Never claim an emergency agency issued it.",
              },
              { role: "user", content: JSON.stringify(payload) },
            ],
          }),
        },
      ).then((result) => result.json());
      return {
        summary: response.choices?.[0]?.message?.content || "",
        draft: true,
        approvalRequired: true,
      };
    },
  },
};
