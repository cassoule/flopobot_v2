import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import {
	activeConnect4Games,
	activeTicTacToeGames,
	connect4Queue,
	queueMessagesEndpoints,
	tictactoeQueue,
} from "../game/state.js";
import {
	C4_ROWS,
	checkConnect4Draw,
	checkConnect4Win,
	createConnect4Board,
	formatConnect4BoardForDiscord,
} from "../game/various.js";
import { eloHandler } from "../game/elo.js";

// --- Module-level State ---
let io;

// --- Main Initialization Function ---

export function initializeSocket(server, client) {
	io = server;

	io.on("connection", (socket) => {
		socket.on("user-connected", async (userId) => {
			if (!userId) return;
			await refreshQueuesForUser(userId, client);
		});

		registerTicTacToeEvents(socket, client);
		registerConnect4Events(socket, client);

		socket.on("tictactoe:queue:leave", async ({ discordId }) => await refreshQueuesForUser(discordId, client));

		// catch tab kills / network drops
		socket.on("disconnecting", async () => {
			const discordId = socket.handshake.auth?.discordId; // or your mapping
			await refreshQueuesForUser(discordId, client);
		});

		socket.on("disconnect", () => {
			//
		});
	});

	setInterval(cleanupStaleGames, 5 * 60 * 1000);
}

export function getSocketIo() {
	return io;
}

// --- Event Registration ---

function registerTicTacToeEvents(socket, client) {
	socket.on("tictactoeconnection", (e) => refreshQueuesForUser(e.id, client));
	socket.on("tictactoequeue", (e) => onQueueJoin(client, "tictactoe", e.playerId));
	socket.on("tictactoeplaying", (e) => onTicTacToeMove(client, e));
	socket.on("tictactoegameOver", (e) => onGameOver(client, "tictactoe", e.playerId, e.winner));
}

function registerConnect4Events(socket, client) {
	socket.on("connect4connection", (e) => refreshQueuesForUser(e.id, client));
	socket.on("connect4queue", (e) => onQueueJoin(client, "connect4", e.playerId));
	socket.on("connect4playing", (e) => onConnect4Move(client, e));
	socket.on("connect4NoTime", (e) => onGameOver(client, "connect4", e.playerId, e.winner, "(temps écoulé)"));
}

// --- Core Handlers (Preserving Original Logic) ---

async function onQueueJoin(client, gameType, playerId) {
	if (!playerId) return;
	const { queue, activeGames, title, url } = getGameAssets(gameType);

	if (
		queue.includes(playerId) ||
		Object.values(activeGames).some((g) => g.p1.id === playerId || g.p2.id === playerId)
	) {
		return;
	}

	queue.push(playerId);
	console.log(`[${title}] Player ${playerId} joined the queue.`);

	if (queue.length === 1) await postQueueToDiscord(client, playerId, title, url);
	if (queue.length >= 2) await createGame(client, gameType);

	await emitQueueUpdate(client, gameType);
}

/**
 * A helper function to check for a win in Tic-Tac-Toe.
 * @param {Array<number>} moves - An array of the player's moves (e.g., [1, 5, 9]).
 * @returns {boolean} - True if the player has won, false otherwise.
 */
function checkTicTacToeWin(moves) {
	const winningCombinations = [
		[1, 2, 3],
		[4, 5, 6],
		[7, 8, 9], // Rows
		[1, 4, 7],
		[2, 5, 8],
		[3, 6, 9], // Columns
		[1, 5, 9],
		[3, 5, 7], // Diagonals
	];
	for (const combination of winningCombinations) {
		if (combination.every((num) => moves.includes(num))) {
			return true;
		}
	}
	return false;
}

async function onTicTacToeMove(client, eventData) {
	const { playerId, value, boxId } = eventData;
	const lobby = Object.values(activeTicTacToeGames).find(
		(g) => (g.p1.id === playerId || g.p2.id === playerId) && !g.gameOver,
	);
	if (!lobby) return;

	const isP1Turn = lobby.sum % 2 === 1 && value === "X" && lobby.p1.id === playerId;
	const isP2Turn = lobby.sum % 2 === 0 && value === "O" && lobby.p2.id === playerId;

	if (isP1Turn || isP2Turn) {
		const playerMoves = isP1Turn ? lobby.xs : lobby.os;
		playerMoves.push(boxId);
		lobby.sum++;
		lobby.lastmove = Date.now();

		if (isP1Turn) lobby.p1.move = boxId;
		if (isP2Turn) lobby.p2.move = boxId;

		io.emit("tictactoeplaying", {
			allPlayers: Object.values(activeTicTacToeGames),
		});
		const hasWon = checkTicTacToeWin(playerMoves);
		if (hasWon) {
			// The current player has won. End the game.
			await onGameOver(client, "tictactoe", playerId, playerId);
		} else if (lobby.sum > 9) {
			// It's a draw (9 moves made, sum is now 10). End the game.
			await onGameOver(client, "tictactoe", playerId, null); // null winner for a draw
		} else {
			// The game continues. Update the state and notify clients.
			await updateDiscordMessage(client, lobby, "Tic Tac Toe");
		}
	}
	await emitQueueUpdate(client, "tictactoe");
}

async function onConnect4Move(client, eventData) {
	const { playerId, col } = eventData;
	const lobby = Object.values(activeConnect4Games).find(
		(l) => (l.p1.id === playerId || l.p2.id === playerId) && !l.gameOver,
	);
	if (!lobby || lobby.turn !== playerId) return;

	const player = lobby.p1.id === playerId ? lobby.p1 : lobby.p2;
	let row;
	for (row = C4_ROWS - 1; row >= 0; row--) {
		if (lobby.board[row][col] === null) {
			lobby.board[row][col] = player.val;
			break;
		}
	}
	if (row < 0) return;

	lobby.lastmove = Date.now();
	const winCheck = checkConnect4Win(lobby.board, player.val);

	let winnerId = null;
	if (winCheck.win) {
		lobby.winningPieces = winCheck.pieces;
		winnerId = player.id;
	} else if (checkConnect4Draw(lobby.board)) {
		winnerId = null; // Represents a draw
	} else {
		lobby.turn = lobby.p1.id === playerId ? lobby.p2.id : lobby.p1.id;
		io.emit("connect4playing", {
			allPlayers: Object.values(activeConnect4Games),
		});
		await emitQueueUpdate(client, "connact4");
		await updateDiscordMessage(client, lobby, "Puissance 4");
		return;
	}
	await onGameOver(client, "connect4", playerId, winnerId);
}

async function onGameOver(client, gameType, playerId, winnerId, reason = "") {
	const { activeGames, title } = getGameAssets(gameType);
	const gameKey = Object.keys(activeGames).find((key) => key.includes(playerId));
	const game = gameKey ? activeGames[gameKey] : undefined;
	if (!game || game.gameOver) return;

	game.gameOver = true;
	let resultText;
	if (winnerId === null) {
		await eloHandler(game.p1.id, game.p2.id, 0.5, 0.5, title.toUpperCase());
		resultText = "Égalité";
	} else {
		await eloHandler(
			game.p1.id,
			game.p2.id,
			game.p1.id === winnerId ? 1 : 0,
			game.p2.id === winnerId ? 1 : 0,
			title.toUpperCase(),
		);
		const winnerName = game.p1.id === winnerId ? game.p1.name : game.p2.name;
		resultText = `Victoire de ${winnerName}`;
	}

	await updateDiscordMessage(client, game, title, `${resultText} ${reason}`);

	if (gameType === "tictactoe") io.emit("tictactoegameOver", { game, winner: winnerId });
	if (gameType === "connect4") io.emit("connect4gameOver", { game, winner: winnerId });

	if (gameKey) {
		setTimeout(() => delete activeGames[gameKey], 1000);
	}
}

// --- Game Lifecycle & Discord Helpers ---

async function createGame(client, gameType) {
	const { queue, activeGames, title } = getGameAssets(gameType);
	const p1Id = queue.shift();
	const p2Id = queue.shift();
	const [p1, p2] = await Promise.all([client.users.fetch(p1Id), client.users.fetch(p2Id)]);

	let lobby;
	if (gameType === "tictactoe") {
		lobby = {
			p1: {
				id: p1Id,
				name: p1.globalName,
				val: "X",
				avatar: p1.displayAvatarURL({ dynamic: true, size: 256 }),
			},
			p2: {
				id: p2Id,
				name: p2.globalName,
				val: "O",
				avatar: p2.displayAvatarURL({ dynamic: true, size: 256 }),
			},
			sum: 1,
			xs: [],
			os: [],
			gameOver: false,
			lastmove: Date.now(),
		};
	} else {
		// connect4
		lobby = {
			p1: {
				id: p1Id,
				name: p1.globalName,
				val: "R",
				avatar: p1.displayAvatarURL({ dynamic: true, size: 256 }),
			},
			p2: {
				id: p2Id,
				name: p2.globalName,
				val: "Y",
				avatar: p2.displayAvatarURL({ dynamic: true, size: 256 }),
			},
			turn: p1Id,
			board: createConnect4Board(),
			gameOver: false,
			lastmove: Date.now(),
			winningPieces: [],
		};
	}

	const msgId = await updateDiscordMessage(client, lobby, title);
	lobby.msgId = msgId;

	const gameKey = `${p1Id}-${p2Id}`;
	activeGames[gameKey] = lobby;

	io.emit(`${gameType}playing`, { allPlayers: Object.values(activeGames) });
	await emitQueueUpdate(client, gameType);
}

// --- Utility Functions ---

async function refreshQueuesForUser(userId, client) {
	// FIX: Mutate the array instead of reassigning it.
	let index = tictactoeQueue.indexOf(userId);
	if (index > -1) {
		tictactoeQueue.splice(index, 1);
		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.BOT_CHANNEL_ID);
			const user = await client.users.fetch(userId);
			const queueMsg = await generalChannel.messages.fetch(queueMessagesEndpoints[userId]);
			const updatedEmbed = new EmbedBuilder()
				.setTitle("Tic Tac Toe")
				.setDescription(`**${user.globalName || user.username}** a quitté la file d'attente.`)
				.setColor(0xed4245)
				.setTimestamp(new Date());
			await queueMsg.edit({ embeds: [updatedEmbed], components: [] });
			delete queueMessagesEndpoints[userId];
		} catch (e) {
			console.error("Error updating queue message : ", e);
		}
	}

	index = connect4Queue.indexOf(userId);
	if (index > -1) {
		connect4Queue.splice(index, 1);
		try {
			const guild = await client.guilds.fetch(process.env.GUILD_ID);
			const generalChannel = await guild.channels.fetch(process.env.BOT_CHANNEL_ID);
			const user = await client.users.fetch(userId);
			const queueMsg = await generalChannel.messages.fetch(queueMessagesEndpoints[userId]);
			const updatedEmbed = new EmbedBuilder()
				.setTitle("Puissance 4")
				.setDescription(`**${user.globalName || user.username}** a quitté la file d'attente.`)
				.setColor(0xed4245)
				.setTimestamp(new Date());
			await queueMsg.edit({ embeds: [updatedEmbed], components: [] });
			delete queueMessagesEndpoints[userId];
		} catch (e) {
			console.error("Error updating queue message : ", e);
		}
	}

	await emitQueueUpdate(client, "tictactoe");
	await emitQueueUpdate(client, "connect4");
}

async function emitQueueUpdate(client, gameType) {
	const { queue, activeGames } = getGameAssets(gameType);
	const names = await Promise.all(
		queue.map(async (id) => {
			const user = await client.users.fetch(id).catch(() => null);
			return user?.globalName || user?.username;
		}),
	);
	io.emit(`${gameType}queue`, {
		allPlayers: Object.values(activeGames),
		queue: names.filter(Boolean),
	});
}

function getGameAssets(gameType) {
	if (gameType === "tictactoe")
		return {
			queue: tictactoeQueue,
			activeGames: activeTicTacToeGames,
			title: "Tic Tac Toe",
			url: "/tic-tac-toe",
		};
	if (gameType === "connect4")
		return {
			queue: connect4Queue,
			activeGames: activeConnect4Games,
			title: "Puissance 4",
			url: "/connect-4",
		};
	return { queue: [], activeGames: {} };
}

async function postQueueToDiscord(client, playerId, title, url) {
	try {
		const generalChannel = await client.channels.fetch(process.env.BOT_CHANNEL_ID);
		const user = await client.users.fetch(playerId);
		const embed = new EmbedBuilder()
			.setTitle(title)
			.setDescription(`**${user.globalName || user.username}** est dans la file d'attente.`)
			.setColor("#5865F2")
			.setTimestamp(new Date());
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setLabel(`Jouer contre ${user.username}`)
				.setURL(`${process.env.DEV_SITE === "true" ? process.env.FLAPI_URL_DEV : process.env.FLAPI_URL}${url}`)
				.setStyle(ButtonStyle.Link),
		);
		const msg = await generalChannel.send({
			embeds: [embed],
			components: [row],
		});
		queueMessagesEndpoints[playerId] = msg.id;
	} catch (e) {
		console.error(`Failed to post queue message for ${title}:`, e);
	}
}

async function updateDiscordMessage(client, game, title, resultText = "") {
	const channel = await client.channels.fetch(process.env.BOT_CHANNEL_ID).catch(() => null);
	if (!channel) return null;

	let description;
	if (title === "Tic Tac Toe") {
		let gridText = "";
		for (let i = 1; i <= 9; i++) {
			gridText += game.xs.includes(i) ? "❌" : game.os.includes(i) ? "⭕" : "🟦";
			if (i % 3 === 0) gridText += "\n";
		}
		description = `### **❌ ${game.p1.name}** vs **${game.p2.name} ⭕**\n${gridText}`;
	} else {
		description = `**🔴 ${game.p1.name}** vs **${game.p2.name} 🟡**\n\n${formatConnect4BoardForDiscord(game.board)}`;
	}
	if (resultText) description += `\n### ${resultText}`;

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setDescription(description)
		.setColor(game.gameOver ? "#2ade2a" : "#5865f2");

	try {
		if (game.msgId) {
			const message = await channel.messages.fetch(game.msgId);
			await message.edit({ embeds: [embed] });
			return game.msgId;
		} else {
			const message = await channel.send({ embeds: [embed] });
			return message.id;
		}
	} catch (e) {
		return null;
	}
}

function cleanupStaleGames() {
	const now = Date.now();
	const STALE_TIMEOUT = 30 * 60 * 1000;
	const cleanup = (games, name) => {
		Object.keys(games).forEach((key) => {
			if (now - games[key].lastmove > STALE_TIMEOUT) {
				console.log(`[Cleanup] Removing stale ${name} game: ${key}`);
				delete games[key];
			}
		});
	};
	cleanup(activeTicTacToeGames, "TicTacToe");
	cleanup(activeConnect4Games, "Connect4");
}

/* EMITS */
export async function socketEmit(event, data) {
	io.emit(event, data);
}

export async function emitDataUpdated(data) {
	io.emit("data-updated", data);
}

export async function emitPokerUpdate(data) {
	io.emit("poker-update", data);
}

export async function emitPokerToast(data) {
	io.emit("poker-toast", data);
}

export const emitUpdate = (type, room) => io.emit("blackjack:update", { type, room });
export const emitToast = (payload) => io.emit("blackjack:toast", payload);

export const emitSolitaireUpdate = (userId, moves) => io.emit("solitaire:update", { userId, moves });

export const emitMarketUpdate = () => io.emit("market:update");
