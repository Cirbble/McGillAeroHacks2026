const ELEVENLABS_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel"

export async function speakText(text) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_KEY,
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v3',
            voice_settings: { stability: 0.75, similarity_boost: 0.75 }
        })
    });

    if (!response.ok) throw new Error(`ElevenLabs API error: ${response.status}`);

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
    return audio;
}

export function generateArrivalAlert(delivery) {
    const mins = Math.floor((new Date(delivery.eta) - new Date()) / 60000);
    return `Alert. Medical delivery arriving at your landing pad in approximately ${mins > 0 ? mins : 14} minutes. Payload: ${delivery.payload}. Manifest I.D.: ${delivery.id}. Landing pad is clear. Please prepare for cartridge retrieval.`;
}

export function generateDispatchConfirmation(delivery) {
    return `Manifest ${delivery.id} has been secured and queued for launch. Payload: ${delivery.payload}. Destination: ${delivery.destination}. Estimated transit time: ${delivery.estimatedTime || '2 hours, 10 minutes'}. Route calculated through ${delivery.legs || 4} relay stations.`;
}

export function generateSystemAlert(message) {
    return `System alert. ${message}. All active flights have been re-evaluated.`;
}
