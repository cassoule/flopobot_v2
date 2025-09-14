import 'dotenv/config';
import OpenAI from "openai";
import {GoogleGenAI} from "@google/genai";
import {Mistral} from '@mistralai/mistralai';

// --- AI Client Initialization ---
// Initialize clients for each AI service. This is done once when the module is loaded.

let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI();
}

let gemini;
if (process.env.GEMINI_KEY) {
    gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_KEY})
}

let mistral;
if (process.env.MISTRAL_KEY) {
    mistral = new Mistral({apiKey: process.env.MISTRAL_KEY});
}


/**
 * Gets a response from the configured AI model.
 * It dynamically chooses the provider based on the MODEL environment variable.
 * @param {Array<object>} messageHistory - The conversation history in a standardized format.
 * @returns {Promise<string>} The content of the AI's response message.
 */
export async function gork(messageHistory) {
    const modelProvider = process.env.MODEL;

    console.log(`[AI] Requesting completion from ${modelProvider}...`);

    try {
        // --- OpenAI Provider ---
        if (modelProvider === 'OpenAI' && openai) {
            const completion = await openai.chat.completions.create({
                model: "gpt-5", // Using a modern, cost-effective model
                reasoning_effort: "low",
                messages: messageHistory,
            });
            return completion.choices[0].message.content;
        }

        // --- Google Gemini Provider ---
        else if (modelProvider === 'Gemini' && gemini) {
            // Gemini requires a slightly different history format.
            const contents = messageHistory.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : msg.role, // Gemini uses 'model' for assistant role
                parts: [{ text: msg.content }],
            }));

            // The last message should not be from the model
            if (contents[contents.length - 1].role === 'model') {
                contents.pop();
            }

            const result = await gemini.generateContent({ contents });
            const response = await result.response;
            return response.text();
        }

        // --- Mistral Provider ---
        else if (modelProvider === 'Mistral' && mistral) {
            const chatResponse = await mistral.chat({
                model: 'mistral-large-latest',
                messages: messageHistory,
            });
            return chatResponse.choices[0].message.content;
        }

        // --- Fallback Case ---
        else {
            console.warn(`[AI] No valid AI provider configured or API key missing for MODEL=${modelProvider}.`);
            return "Le service d'IA n'est pas correctement configuré. Veuillez contacter l'administrateur.";
        }
    } catch(error) {
        console.error(`[AI] Error with ${modelProvider} API:`, error);
        return "Oups, une erreur est survenue en contactant le service d'IA.";
    }
}

export const CONTEXT_LIMIT = parseInt(process.env.AI_CONTEXT_MESSAGES || '100', 10);
export const MAX_ATTS_PER_MESSAGE = parseInt(process.env.AI_MAX_ATTS_PER_MSG || '3', 10);
export const INCLUDE_ATTACHMENT_URLS = (process.env.AI_INCLUDE_ATTACHMENT_URLS || 'true') === 'true';

export const stripMentionsOfBot = (text, botId) =>
    text.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();

export const sanitize = (s) =>
    (s || '')
        .replace(/\s+/g, ' ')
        .replace(/```/g, 'ʼʼʼ') // éviter de casser des fences éventuels
        .trim();

export const shortTs = (d) => new Date(d).toISOString(); // compact et triable

export function buildParticipantsMap(messages) {
    const map = {};
    for (const m of messages) {
        const id = m.author.id;
        if (!map[id]) {
            map[id] = {
                id,
                username: m.author.username,
                globalName: m.author.globalName || null,
                isBot: !!m.author.bot,
            };
        }
    }
    return map;
}

export function buildTranscript(messages, botId) {
    // Oldest -> newest, JSONL compact, une ligne par message pertinent
    const lines = [];
    for (const m of messages) {
        const content = sanitize(m.content);
        const atts = Array.from(m.attachments?.values?.() || []);
        if (!content && atts.length === 0) continue;

        const attMeta = atts.length
            ? atts.slice(0, MAX_ATTS_PER_MESSAGE).map(a => ({
                id: a.id,
                name: a.name,
                type: a.contentType || 'application/octet-stream',
                size: a.size,
                isImage: !!(a.contentType && a.contentType.startsWith('image/')),
                width: a.width || undefined,
                height: a.height || undefined,
                spoiler: typeof a.spoiler === 'boolean' ? a.spoiler : false,
                url: INCLUDE_ATTACHMENT_URLS ? a.url : undefined, // désactive par défaut
            }))
            : undefined;

        const line = {
            t: shortTs(m.createdTimestamp || Date.now()),
            id: m.author.id,
            nick: m.member?.nickname || m.author.globalName || m.author.username,
            isBot: !!m.author.bot,
            mentionsBot: new RegExp(`<@!?${botId}>`).test(m.content || ''),
            replyTo: m.reference?.messageId || null,
            content,
            attachments: attMeta,
        };
        lines.push(line);
    }
    return lines.map(l => JSON.stringify(l)).join('\n');
}

export function buildAiMessages({
    botId,
    botName = 'FlopoBot',
    invokerId,
    invokerName,
    requestText,
    transcript,
    participants,
    repliedUserId,
    invokerAttachments = [],
}) {
    const system = {
        role: 'system',
        content:
            `Tu es ${botName} (ID: ${botId}) sur un serveur Discord. Style: bref, naturel, détendu, comme un pote.
            Règles de sortie:
            - Réponds en français, en 1–3 phrases.
            - Réponds PRINCIPALEMENT au message de <@${invokerId}>. Le transcript est un contexte facultatif.
            - Pas de "Untel a dit…", pas de longs préambules.
            - Utilise <@ID> pour mentionner quelqu'un.
            - Tu ne peux PAS ouvrir les liens; si des pièces jointes existent, tu peux simplement les mentionner (ex: "ta photo", "le PDF").`,
    };

    const attLines = invokerAttachments.length
        ? invokerAttachments.map(a => `- ${a.name} (${a.type || 'type inconnu'}, ${a.size ?? '?'} o${a.isImage ? ', image' : ''})`).join('\n')
        : '';

    const user = {
        role: 'user',
        content:
            `Tâche: répondre brièvement à <@${invokerId}>.

            Message de <@${invokerId}> (${invokerName || 'inconnu'}):
            """
            ${requestText}
            """
            ${invokerAttachments.length ? `Pièces jointes du message: 
            ${attLines}
            ` : ''}${repliedUserId ? `Ce message répond à <@${repliedUserId}>.` : ''}
            
            Participants (id -> nom):
            ${Object.values(participants).map(p => `- ${p.id} -> ${p.globalName || p.username}`).join('\n')}
            
            Contexte (transcript JSONL; à utiliser seulement si utile):
            \`\`\`jsonl
            ${transcript}
            \`\`\``,
    };

    return [system, user];
}