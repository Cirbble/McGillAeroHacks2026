const INSIGHT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_GEMINI_FLASH_THINKING_LEVEL = 'minimal';
const GEMINI_RETRYABLE_STATUSES = new Set([429, 500, 503]);
const OPERATOR_INSIGHT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'action', 'watch'],
    properties: {
        summary: { type: 'string' },
        action: { type: 'string' },
        watch: { type: 'string' },
    },
};

let insightCache = {
    key: null,
    fetchedAt: 0,
    payload: null,
};

let pathInsightCache = {
    key: null,
    fetchedAt: 0,
    payload: null,
};

function compactText(value) {
    return String(value || '').trim();
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^"(.*)"$/s, '$1')
        .replace(/^[>\-\*\u2022]+\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function ensureSentence(value) {
    const clean = stripMarkdown(value)
        .replace(/^(summary|action|watch|monitor|risk)\s*:\s*/i, '')
        .trim();

    if (!clean) return '';
    return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function uniqueNonEmpty(values = []) {
    return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

function formatInsightParts(parts = [], fallback = '') {
    const sentences = uniqueNonEmpty(parts.map(ensureSentence)).slice(0, 3);
    if (sentences.length > 0) {
        return sentences.join(' ');
    }

    return ensureSentence(fallback) || 'Insight unavailable.';
}

function extractLabeledInsight(rawText) {
    const lines = String(rawText || '')
        .split(/\n+/)
        .map((line) => stripMarkdown(line))
        .filter(Boolean);
    const parsed = { summary: '', action: '', watch: '' };

    for (const line of lines) {
        const match = line.match(/^(summary|action|watch|monitor|risk)\s*:\s*(.+)$/i);
        if (!match) continue;

        const [, label, content] = match;
        const key = /^(watch|monitor|risk)$/i.test(label) ? 'watch' : label.toLowerCase();
        if (!parsed[key]) {
            parsed[key] = content;
        }
    }

    return Object.values(parsed).some(Boolean) ? parsed : null;
}

function normalizeInsightContent(rawText, fallback = '') {
    const labeled = extractLabeledInsight(rawText);
    if (labeled) {
        return formatInsightParts([labeled.summary, labeled.action, labeled.watch], fallback);
    }

    const normalized = stripMarkdown(rawText)
        .replace(/\s+[•\-]\s+/g, '. ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const segments = normalized
        ? normalized
            .split(/(?<=[.!?])\s+|\s+-\s+/)
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [];

    return formatInsightParts(segments, fallback);
}

function buildTextFallbackPrompt(prompt) {
    return String(prompt || '')
        .replace(
            /Return JSON fields named summary, action, and watch\.\s*Each field should be one short sentence\.\s*Do not use markdown\./i,
            'Reply in exactly three short plain-text lines labeled Summary, Action, and Watch.',
        );
}

function isGemini3Model(model) {
    return String(model || '').startsWith('gemini-3');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildThinkingConfig(model, options = {}) {
    const thinkingLevel = options.thinkingLevel
        || process.env.GEMINI_THINKING_LEVEL
        || (isGemini3Model(model) ? DEFAULT_GEMINI_FLASH_THINKING_LEVEL : undefined);
    const thinkingBudget = options.thinkingBudget ?? process.env.GEMINI_THINKING_BUDGET;

    if (isGemini3Model(model)) {
        return thinkingLevel ? { thinkingLevel } : undefined;
    }

    if (thinkingBudget === undefined || thinkingBudget === null || thinkingBudget === '') {
        return undefined;
    }

    return { thinkingBudget: Number(thinkingBudget) };
}

function tryParseJsonPayload(rawText) {
    const candidates = [
        rawText,
        rawText.replace(/```json\s*/gi, '').replace(/```/g, '').trim(),
        rawText.includes('{') && rawText.includes('}')
            ? rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1).trim()
            : '',
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // Try the next candidate.
        }
    }

    throw new Error(`Gemini returned invalid JSON: ${rawText.slice(0, 240)}`);
}

async function callGeminiRequest(prompt, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

    if (!apiKey) {
        throw new Error('Gemini is not configured in the backend environment.');
    }

    const generationConfig = {
        temperature: options.temperature ?? (isGemini3Model(model) ? 1 : 0.3),
        maxOutputTokens: options.maxOutputTokens ?? 350,
    };
    const thinkingConfig = buildThinkingConfig(model, options);
    if (thinkingConfig) {
        generationConfig.thinkingConfig = thinkingConfig;
    }
    if (options.responseMimeType) {
        generationConfig.responseMimeType = options.responseMimeType;
    }
    if (options.responseSchema) {
        generationConfig.responseSchema = options.responseSchema;
    } else if (options.responseJsonSchema) {
        generationConfig.responseJsonSchema = options.responseJsonSchema;
    }

    const retryDelays = options.retryDelaysMs || [800, 1800];
    const requestBody = {
        ...(options.systemInstruction ? {
            systemInstruction: {
                parts: [{ text: options.systemInstruction }],
            },
        } : {}),
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }],
            },
        ],
        generationConfig,
    };

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify(requestBody),
        });

        if (response.ok) {
            return response.json();
        }

        const errorText = await response.text();
        const retryAfter = Number(response.headers.get('retry-after'));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : retryDelays[attempt];

        if (
            GEMINI_RETRYABLE_STATUSES.has(response.status)
            && delayMs
            && attempt < retryDelays.length
        ) {
            await sleep(delayMs);
            continue;
        }

        throw new Error(`Gemini request failed with status ${response.status}: ${errorText.slice(0, 240)}`);
    }
}

export async function callGeminiText(prompt, options = {}) {
    const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const payload = await callGeminiRequest(prompt, options);
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n').trim();

    return {
        available: true,
        provider: 'gemini',
        model,
        content: compactText(content) || 'Gemini did not return an insight.',
    };
}

export async function callGeminiOperatorInsight(prompt, options = {}) {
    const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    try {
        const result = await callGeminiJson(prompt, OPERATOR_INSIGHT_SCHEMA, {
            ...options,
            maxOutputTokens: options.maxOutputTokens ?? 400,
            systemInstruction: options.systemInstruction || 'Return plain operational guidance as JSON only. Do not use markdown.',
        });

        return {
            available: true,
            provider: 'gemini',
            model,
            content: formatInsightParts(
                [result.data.summary, result.data.action, result.data.watch],
                options.fallbackContent,
            ),
            rawText: result.rawText,
            data: result.data,
        };
    } catch (jsonError) {
        const textResult = await callGeminiText(
            `${buildTextFallbackPrompt(prompt)}\n\nFallback mode: ignore any request to return JSON. Reply in exactly three short plain-text lines:\nSummary: ...\nAction: ...\nWatch: ...`,
            {
                ...options,
                maxOutputTokens: 240,
                systemInstruction: 'Return concise operational guidance. Prefer the labels Summary, Action, and Watch. Do not use markdown bullets.',
            },
        );

        return {
            available: true,
            provider: 'gemini',
            model,
            content: normalizeInsightContent(textResult.content, options.fallbackContent),
            rawText: textResult.content,
            degraded: true,
            error: jsonError.message,
        };
    }
}

export async function callGeminiJson(prompt, responseSchema, options = {}) {
    const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const payload = await callGeminiRequest(prompt, {
        ...options,
        responseMimeType: 'application/json',
        responseJsonSchema: responseSchema,
    });
    const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join('').trim();
    if (!rawText) {
        throw new Error('Gemini did not return a JSON payload.');
    }

    return {
        available: true,
        provider: 'gemini',
        model,
        rawText,
        data: tryParseJsonPayload(rawText),
    };
}

export async function callSnowflakeCortex(messages, options = {}) {
    const snowflakeUrl = process.env.SNOWFLAKE_ACCOUNT_URL;
    const snowflakePat = process.env.SNOWFLAKE_PAT;
    const model = options.model || process.env.SNOWFLAKE_CORTEX_MODEL || 'mistral-large2';

    if (!snowflakeUrl || !snowflakePat) {
        return {
            available: false,
            provider: 'snowflake',
            model,
            content: 'Snowflake Cortex is not configured in the backend environment.',
        };
    }

    const response = await fetch(`${snowflakeUrl}/api/v2/cortex/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${snowflakePat}`,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: options.temperature ?? 0.25,
            max_completion_tokens: options.maxCompletionTokens ?? 700,
        }),
    });

    if (!response.ok) {
        throw new Error(`Snowflake Cortex request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
        available: true,
        provider: 'snowflake',
        model: payload.model || model,
        content: compactText(payload.choices?.[0]?.message?.content) || 'Snowflake Cortex did not return an insight.',
    };
}

function buildContextKey(context) {
    return JSON.stringify({
        recommendation: context.recommendation,
        notifications: context.notifications.map((notification) => ({
            deliveryId: notification.deliveryId,
            title: notification.title,
        })),
        topWeather: context.weatherStations.slice(0, 5).map((station) => ({
            stationId: station.stationId,
            condition: station.condition,
        })),
        metrics: context.metrics,
    });
}

function buildInsightPrompt(context) {
    const notificationLines = context.notifications.length > 0
        ? context.notifications.map((notification) => `- ${notification.title}: ${notification.detail}`).join('\n')
        : '- No high-priority notifications.';
    const weatherLines = context.weatherStations.length > 0
        ? context.weatherStations
            .slice()
            .sort((left, right) => right.riskScore - left.riskScore)
            .slice(0, 6)
            .map((station) => `- ${station.stationId}: ${station.condition}, ${station.summary}${station.issues[0] ? `, issue=${station.issues[0]}` : ''}`)
            .join('\n')
        : '- No weather stations available.';

    return `You are the Aero'ed network operations copilot for a medical drone relay corridor in Northern Quebec.

Give a concise operator recommendation for the admin overview. Focus on weather, rerouting, delivery risk, and what the operator should do next.
Return JSON fields named summary, action, and watch. Each field should be one short sentence. Do not use markdown.

CURRENT RECOMMENDATION:
${context.recommendation}

METRICS:
- Active flights: ${context.metrics.activeFlights}
- Stations on weather watch: ${context.metrics.watchStations}
- Severe or unstable nodes: ${context.metrics.severeStations}
- Weather holds: ${context.metrics.weatherHolds}
- Active reroutes: ${context.metrics.reroutedFlights}

NOTIFICATIONS:
${notificationLines}

TOP WEATHER RISKS:
${weatherLines}`;
}

function buildSnowflakeMessages(context) {
    return [
        {
            role: 'system',
            content: 'You are Aero\'ed Corridor Intelligence. Recommend the best operational action for the admin team. Return exactly three short plain-text lines labeled Summary, Action, and Watch. No markdown or bullet characters.',
        },
        {
            role: 'user',
            content: buildInsightPrompt(context),
        },
    ];
}

function buildPathInsightPrompt(context) {
    const signals = (context.pathReport.weatherSignals || []).map((signal) => `- ${signal}`).join('\n') || '- No weather signals.';
    const warnings = (context.delivery.routeWarnings || []).map((warning) => `- ${warning.stationId}: ${warning.detail}`).join('\n') || '- No route warnings.';

    return `You are the Aero'ed route copilot for a medical drone relay mission in Northern Quebec.

Give concise mission-specific guidance for the currently selected path. Focus only on this mission's route, weather exposure, reroute state, ETA confidence, and what the operator should do next.
Every response must mention the current ETA or whether it is likely to slip.
Return JSON fields named summary, action, and watch. Each field should be one short sentence. Do not use markdown.

MISSION:
- Delivery ID: ${context.delivery.id}
- Payload: ${context.delivery.payload}
- Status: ${context.delivery.status}
- Route: ${context.delivery.route.join(' → ')}
- ETA: ${context.delivery.estimatedTime}
- Total route distance: ${context.pathReport.routeDistanceKm ?? 'Unavailable'} km
- Remaining route distance: ${context.pathReport.remainingDistanceKm ?? 'Unavailable'} km
- Cruise speed used: ${context.pathReport.cruiseSpeedKph ?? 'Unavailable'} km/h (${context.pathReport.speedSource || 'No source'})
- Base flight time: ${context.pathReport.baseFlightMinutes ?? 'Unavailable'} minutes
- Weather delay: ${context.pathReport.weatherDelayMinutes ?? 0} minutes
- Relay handoff delay: ${context.pathReport.handoffDelayMinutes ?? 0} minutes

PATH WEATHER REPORT:
- Headline: ${context.pathReport.headline}
- Summary: ${context.pathReport.summary}
- Operational effect: ${context.pathReport.operationalEffect}
- Impacted stops: ${context.pathReport.impactedStops}
- Severe stops: ${context.pathReport.severeCount}
- Unstable stops: ${context.pathReport.unstableCount}
- Watch stops: ${context.pathReport.watchCount}

WEATHER SIGNALS:
${signals}

PATH WARNINGS:
${warnings}

RECOMMENDED ACTION:
${context.pathReport.recommendedAction}`;
}

function buildPathSnowflakeMessages(context) {
    return [
        {
            role: 'system',
            content: 'You are Aero\'ed Corridor Intelligence. Give concise guidance for the selected delivery path only. Return exactly three short plain-text lines labeled Summary, Action, and Watch. No markdown or bullet characters.',
        },
        {
            role: 'user',
            content: buildPathInsightPrompt(context),
        },
    ];
}

export async function getOperationalInsights(context) {
    const cacheKey = buildContextKey(context);
    if (
        insightCache.payload
        && insightCache.key === cacheKey
        && Date.now() - insightCache.fetchedAt < INSIGHT_CACHE_TTL_MS
    ) {
        return insightCache.payload;
    }

    const prompt = buildInsightPrompt(context);
    const fallback = {
        recommendedAction: context.recommendation,
        gemini: {
            available: false,
            provider: 'gemini',
            model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            content: context.recommendation,
        },
        snowflake: {
            available: false,
            provider: 'snowflake',
            model: process.env.SNOWFLAKE_CORTEX_MODEL || 'mistral-large2',
            content: context.recommendation,
        },
    };

    const [geminiResult, snowflakeResult] = await Promise.allSettled([
        callGeminiOperatorInsight(prompt, {
            thinkingLevel: 'minimal',
            fallbackContent: context.recommendation,
        }),
        callSnowflakeCortex(buildSnowflakeMessages(context), {
            maxCompletionTokens: 180,
        }),
    ]);

    const payload = {
        recommendedAction: context.recommendation,
        gemini: geminiResult.status === 'fulfilled'
            ? geminiResult.value
            : {
                ...fallback.gemini,
                content: formatInsightParts(['Gemini unavailable', context.recommendation], context.recommendation),
                error: geminiResult.reason?.message,
            },
        snowflake: snowflakeResult.status === 'fulfilled'
            ? {
                ...snowflakeResult.value,
                content: normalizeInsightContent(snowflakeResult.value.content, context.recommendation),
            }
            : {
                ...fallback.snowflake,
                content: formatInsightParts(['Snowflake fallback', context.recommendation], context.recommendation),
                error: snowflakeResult.reason?.message,
            },
    };

    insightCache = {
        key: cacheKey,
        fetchedAt: Date.now(),
        payload,
    };

    return payload;
}

export async function getPathOperationalInsights(context) {
    const cacheKey = JSON.stringify({
        deliveryId: context.delivery.id,
        status: context.delivery.status,
        route: context.delivery.route,
        estimatedTime: context.delivery.estimatedTime,
        estimatedMinutes: context.delivery.estimatedMinutes,
        cruiseSpeedKph: context.pathReport.cruiseSpeedKph,
        weatherDelayMinutes: context.pathReport.weatherDelayMinutes,
        handoffDelayMinutes: context.pathReport.handoffDelayMinutes,
        warnings: context.delivery.routeWarnings,
        recommendedAction: context.pathReport.recommendedAction,
        rerouteActive: context.pathReport.rerouteActive,
    });

    if (
        pathInsightCache.payload
        && pathInsightCache.key === cacheKey
        && Date.now() - pathInsightCache.fetchedAt < INSIGHT_CACHE_TTL_MS
    ) {
        return pathInsightCache.payload;
    }

    const prompt = buildPathInsightPrompt(context);
    const etaFallback = context.delivery.estimatedTime
        ? `ETA ${context.delivery.estimatedTime}. ${context.pathReport.recommendedAction}`
        : context.pathReport.recommendedAction;
    const fallback = {
        pathReport: context.pathReport,
        gemini: {
            available: false,
            provider: 'gemini',
            model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            content: etaFallback,
        },
        snowflake: {
            available: false,
            provider: 'snowflake',
            model: process.env.SNOWFLAKE_CORTEX_MODEL || 'mistral-large2',
            content: etaFallback,
        },
    };

    const [geminiResult, snowflakeResult] = await Promise.allSettled([
        callGeminiOperatorInsight(prompt, {
            thinkingLevel: 'minimal',
            fallbackContent: etaFallback,
        }),
        callSnowflakeCortex(buildPathSnowflakeMessages(context), {
            maxCompletionTokens: 180,
        }),
    ]);

    const payload = {
        pathReport: context.pathReport,
        gemini: geminiResult.status === 'fulfilled'
            ? geminiResult.value
            : {
                ...fallback.gemini,
                content: formatInsightParts(['Gemini unavailable', etaFallback], etaFallback),
                error: geminiResult.reason?.message,
            },
        snowflake: snowflakeResult.status === 'fulfilled'
            ? {
                ...snowflakeResult.value,
                content: normalizeInsightContent(snowflakeResult.value.content, etaFallback),
            }
            : {
                ...fallback.snowflake,
                content: formatInsightParts(['Snowflake fallback', etaFallback], etaFallback),
                error: snowflakeResult.reason?.message,
            },
    };

    pathInsightCache = {
        key: cacheKey,
        fetchedAt: Date.now(),
        payload,
    };

    return payload;
}
