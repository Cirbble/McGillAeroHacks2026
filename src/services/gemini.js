const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${GEMINI_KEY}`;
const DEFAULT_CORRIDOR = ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Wemindji', 'Chisasibi', 'Whapmagoostui'];

function buildSystemPrompt(stations = []) {
    if (stations.length === 0) {
        return `You are the Aero'ed AI Dispatch Engine — an intelligent logistics routing system for drone relay medicine delivery corridors in Northern Quebec, Canada.

CONTEXT:
- Aero'ed operates a relay network of solar-powered charging stations between Chibougamau (regional hospital) and remote Cree/Inuit communities along James Bay.
- Drones carry sealed medicine cartridges 20km per leg, swapping at each station to a fresh drone.
- The corridor: Chibougamau Hub → Station Alpha (Mistissini) → Station Beta (Nemaska) → Station Gamma (Waskaganish) → Chisasibi → Whapmagoostui.
- Station Gamma (Waskaganish) is currently under scheduled maintenance.

AVAILABLE DESTINATIONS: Mistissini, Nemaska, Waskaganish, Eastmain, Wemindji, Chisasibi, Whapmagoostui

When a user describes a delivery request in natural language, respond with ONLY valid JSON (no markdown, no backticks):
{
  "payload": "description of the medicine/supplies",
  "weight_kg": estimated weight as number,
  "origin": "Chibougamau Hub",
  "destination": "one of the available destinations",
  "priority": "Routine" or "Urgent" or "Emergency",
  "route": ["list", "of", "stations", "in", "order"],
  "estimated_legs": number of relay legs,
  "estimated_time_minutes": total estimated time,
  "reasoning": "Brief explanation of route choice, any rerouting needed"
}`;
    }

    const orderedStations = [...stations].sort((a, b) => {
        const aIndex = DEFAULT_CORRIDOR.indexOf(a.id);
        const bIndex = DEFAULT_CORRIDOR.indexOf(b.id);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    });

    const corridor = orderedStations.map((station) => station.id).join(' → ');
    const destinations = orderedStations
        .filter((station) => station.type !== 'distribution')
        .map((station) => station.id)
        .join(', ');
    const statusLines = orderedStations
        .map((station) => `- ${station.id}: ${station.status}${station.type ? ` (${station.type})` : ''}`)
        .join('\n');

    return `You are the Aero'ed AI Dispatch Engine — an intelligent logistics routing system for drone relay medicine delivery corridors in Northern Quebec, Canada.

CONTEXT:
- Aero'ed operates a relay network of solar-powered charging stations between Chibougamau and remote Cree/Inuit communities along James Bay.
- Drones carry sealed medicine cartridges 20km per leg, swapping at each station to a fresh drone.
- The current corridor order is: ${corridor}
- Use the live node status below when choosing routes.

LIVE NODE STATUS:
${statusLines}

AVAILABLE DESTINATIONS: ${destinations}

When a user describes a delivery request in natural language, respond with ONLY valid JSON (no markdown, no backticks):
{
  "payload": "description of the medicine/supplies",
  "weight_kg": estimated weight as number,
  "origin": "Chibougamau Hub",
  "destination": "one of the available destinations",
  "priority": "Routine" or "Urgent" or "Emergency",
  "route": ["list", "of", "stations", "in", "order"],
  "estimated_legs": number of relay legs,
  "estimated_time_minutes": total estimated time,
  "reasoning": "Brief explanation of route choice, any rerouting needed"
}`;
}

export async function dispatchWithGemini(userPrompt, stations = []) {
    const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                { role: 'user', parts: [{ text: buildSystemPrompt(stations) + '\n\nUser request: ' + userPrompt }] }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 500,
            }
        })
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response from Gemini');

    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
}
