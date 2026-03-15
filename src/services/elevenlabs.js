const ELEVENLABS_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

let audioCtx = null;

function getSpeechLocale(lang = 'en') {
    return {
        en: 'en-US',
        fr: 'fr-CA',
        iu: 'iu-Cans-CA',
    }[lang] || 'en-US';
}

function speakWithBrowserVoices(text, lang = 'en') {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
        throw new Error('Speech synthesis is not available in this browser.');
    }

    return new Promise((resolve, reject) => {
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = getSpeechLocale(lang);
        const voices = window.speechSynthesis.getVoices();
        const matchingVoice = voices.find((voice) => voice.lang === utterance.lang)
            || voices.find((voice) => voice.lang.startsWith(utterance.lang.split('-')[0]))
            || null;
        if (matchingVoice) {
            utterance.voice = matchingVoice;
        }
        utterance.onend = resolve;
        utterance.onerror = () => reject(new Error('Browser speech synthesis failed.'));
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    });
}

export async function speakText(text, lang = 'en') {
    const langMap = { en: 'en', fr: 'fr', iu: 'iu' };
    const languageCode = langMap[lang] || 'en';

    if (!ELEVENLABS_KEY) {
        return speakWithBrowserVoices(text, lang);
    }

    try {
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
                voice_settings: { stability: 0.75, similarity_boost: 0.75 },
            }),
        });

        if (!response.ok) throw new Error(`ElevenLabs API error: ${response.status}`);

        if (!audioCtx) audioCtx = new AudioContext();
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start(0);

        return await new Promise((resolve) => {
            source.onended = resolve;
        });
    } catch {
        return speakWithBrowserVoices(text, lang);
    }
}

export function generateArrivalAlert(delivery, lang = 'en') {
    const minutes = Math.floor((new Date(delivery.eta) - new Date()) / 60000);
    const safeMinutes = minutes > 0 ? minutes : 14;

    if (lang === 'fr') {
        return `Alerte. Livraison medicale dans environ ${safeMinutes} minutes. Chargement: ${delivery.payload}. Manifeste: ${delivery.id}. Preparez la reception.`;
    }
    if (lang === 'iu') {
        return `Alert. Medical delivery arriving in about ${safeMinutes} minutes. Payload: ${delivery.payload}. Manifest: ${delivery.id}.`;
    }
    return `Alert. Medical delivery arriving in approximately ${safeMinutes} minutes. Payload: ${delivery.payload}. Manifest ID: ${delivery.id}. Please prepare for receipt.`;
}

export function generateDispatchConfirmation(delivery, lang = 'en') {
    if (lang === 'fr') {
        return `Manifeste ${delivery.id} cree. Chargement: ${delivery.payload}. Destination: ${delivery.destination}. Temps estime: ${delivery.estimatedTime || '2 heures'}. Le vol est actif si un drone est disponible.`;
    }
    if (lang === 'iu') {
        return `Manifest ${delivery.id} created. Payload: ${delivery.payload}. Destination: ${delivery.destination}.`;
    }
    return `Manifest ${delivery.id} created. Payload: ${delivery.payload}. Destination: ${delivery.destination}. Estimated transit time: ${delivery.estimatedTime || '2 hours'}. The mission is active when fleet conditions allow.`;
}

export function generateSystemAlert(message, lang = 'en') {
    if (lang === 'fr') return `Alerte systeme. ${message}. Les vols actifs ont ete reevalues.`;
    if (lang === 'iu') return `System alert. ${message}.`;
    return `System alert. ${message}. All active flights have been re-evaluated.`;
}
