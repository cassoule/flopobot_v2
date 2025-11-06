import "dotenv/config";

/**
 * A generic function for making requests to the Discord API.
 * It handles URL construction, authentication, and basic error handling.
 *
 * @param {string} endpoint - The API endpoint to request (e.g., 'channels/123/messages').
 * @param {object} [options] - Optional fetch options (method, body, etc.).
 * @returns {Promise<Response>} The raw fetch response object.
 * @throws Will throw an error if the API request is not successful.
 */
export async function DiscordRequest(endpoint, options) {
	// Construct the full API URL
	const url = "https://discord.com/api/v10/" + endpoint;

	// Stringify the payload if it exists
	if (options && options.body) {
		options.body = JSON.stringify(options.body);
	}

	// Use fetch to make the request, automatically including required headers
	const res = await fetch(url, {
		headers: {
			Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
			"Content-Type": "application/json; charset=UTF-8",
			"User-Agent": "DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)",
		},
		...options, // Spread the given options (e.g., method, body)
	});

	// If the request was not successful, throw a detailed error
	if (!res.ok) {
		let data;
		try {
			data = await res.json();
		} catch (err) {
			data = res;
		}
		console.error(`Discord API Error on endpoint ${endpoint}:`, res.status, data);
		throw new Error(JSON.stringify(data));
	}

	// Return the original response object for further processing
	return res;
}

/**
 * Installs or overwrites all global slash commands for the application.
 *
 * @param {string} appId - The application (client) ID.
 * @param {Array<object>} commands - An array of command objects to install.
 */
export async function InstallGlobalCommands(appId, commands) {
	// API endpoint for bulk overwriting global commands
	const endpoint = `applications/${appId}/commands`;

	console.log("Installing global commands...");
	try {
		// This uses the generic DiscordRequest function to make the API call
		await DiscordRequest(endpoint, { method: "PUT", body: commands });
		console.log("Successfully installed global commands.");
	} catch (err) {
		console.error("Error installing global commands:", err);
	}
}
