export async function dispatchWithGemini(userPrompt) {
    const response = await fetch('/api/dispatch/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt }),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
        throw new Error(data?.error || `Gemini planning failed with status ${response.status}`);
    }

    return data;
}
