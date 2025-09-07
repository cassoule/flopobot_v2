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