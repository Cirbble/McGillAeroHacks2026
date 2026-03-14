const ELEVENLABS_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel"

let audioCtx = null;

export async function speakText(text, lang = 'en') {
    // Map language codes to ISO 639-1
    const langMap = { en: 'en', fr: 'fr', iu: 'iu' };
    const languageCode = langMap[lang] || 'en';

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_KEY,
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            ...(languageCode && languageCode !== 'iu' ? { language_code: languageCode } : {}),
            voice_settings: { stability: 0.75, similarity_boost: 0.75 }
        })
    });

    if (!response.ok) throw new Error(`ElevenLabs API error: ${response.status}`);

    if (!audioCtx) audioCtx = new AudioContext();
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);

    return new Promise(resolve => { source.onended = resolve; });
}

// Multilingual alert generators
export function generateArrivalAlert(delivery, lang = 'en') {
    const mins = Math.floor((new Date(delivery.eta) - new Date()) / 60000);
    const m = mins > 0 ? mins : 14;

    if (lang === 'fr') {
        return `Alerte. Livraison médicale en approche de votre plateforme d'atterrissage dans environ ${m} minutes. Chargement: ${delivery.payload}. Numéro de manifeste: ${delivery.id}. La plateforme est dégagée. Veuillez préparer la récupération de la cartouche.`;
    }
    if (lang === 'iu') {
        return `Uqautikkannirrlusi. Aannialiriikutit tikinniaqqtut ${m} minitsimi. Payload: ${delivery.payload}. Manifest: ${delivery.id}. Piliriivik ukkuaingajuq.`;
    }
    return `Alert. Medical delivery arriving at your landing pad in approximately ${m} minutes. Payload: ${delivery.payload}. Manifest I.D.: ${delivery.id}. Landing pad is clear. Please prepare for cartridge retrieval.`;
}

export function generateDispatchConfirmation(delivery, lang = 'en') {
    if (lang === 'fr') {
        return `Manifeste ${delivery.id} sécurisé et en file d'attente pour le lancement. Chargement: ${delivery.payload}. Destination: ${delivery.destination}. Temps de transit estimé: ${delivery.estimatedTime || '2 heures, 10 minutes'}. Itinéraire calculé à travers ${delivery.legs || 4} stations relais.`;
    }
    if (lang === 'iu') {
        return `Titiraqsimajuq ${delivery.id} atuinnauliqqtuq. ${delivery.payload}. Uvungauniaqqtuq: ${delivery.destination}.`;
    }
    return `Manifest ${delivery.id} has been secured and queued for launch. Payload: ${delivery.payload}. Destination: ${delivery.destination}. Estimated transit time: ${delivery.estimatedTime || '2 hours, 10 minutes'}. Route calculated through ${delivery.legs || 4} relay stations.`;
}

export function generateSystemAlert(message, lang = 'en') {
    if (lang === 'fr') return `Alerte système. ${message}. Tous les vols actifs ont été réévalués.`;
    if (lang === 'iu') return `Uqautikkannirrlusi. ${message}.`;
    return `System alert. ${message}. All active flights have been re-evaluated.`;
}
