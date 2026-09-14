import OpenAI from 'openai';

const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });

const SYSTEM_PROMPT = `You write official wildfire evacuation alerts issued by county emergency management.
Rules:
- Each alert must be under 320 characters.
- Calm, plain, direct language. No emojis, no hashtags, no exclamation marks.
- State the zone code and name, the status, and the action residents should take.
- Write one alert per requested language, fully translated into that language.
- Respond with strict JSON only: an object whose keys are the requested language codes and whose values are the alert strings.`;

export async function POST(req: Request) {
  const { zone, status, langs } = await req.json().catch(() => ({}));
  if (!zone?.code || !status || !Array.isArray(langs) || !langs.length) {
    return Response.json({ error: 'body must be { zone, status, langs: string[] }' }, { status: 400 });
  }

  const completion = await groq.chat.completions.create({
    // llama-3.3-70b-versatile has been retired on Groq; override with GROQ_MODEL if this one is too.
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Zone: ${zone.code} (${zone.name ?? 'unnamed'}), population ${zone.population ?? 'unknown'}.
Status: ${status}.
Languages: ${langs.join(', ')}.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? '';
  try {
    return Response.json(JSON.parse(content));
  } catch {
    return Response.json({ error: 'model returned invalid JSON', raw: content }, { status: 502 });
  }
}
