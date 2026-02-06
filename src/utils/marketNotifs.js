import * as userService from "../services/user.service.js";
import * as skinService from "../services/skin.service.js";
import * as marketService from "../services/market.service.js";
import { EmbedBuilder } from "discord.js";

export async function handleNewMarketOffer(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const skin = await skinService.getSkin(offer.skinUuid);

	const discordUserSeller = await client.users.fetch(offer.sellerId);
	try {
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Offre créée")
				.setDescription(`Ton offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** a bien été créée !`)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "📌 Statut",
						value: `\`${offer.status}\``,
						inline: true,
					},
					{
						name: "💰 Prix de départ",
						value: `\`${offer.startingPrice} coins\``,
						inline: true,
					},
					{
						name: "⏰ Ouverture",
						value: `<t:${Math.floor(offer.openingAt / 1000)}:F>`,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
					},
					{
						name: "🆔 ID de l’offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}
	// Send notification in guild channel

	try {
		const guildChannel = await client.channels.fetch(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Nouvelle offre")
			.setDescription(`Une offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** a été créée !`)
			.setThumbnail(skin.displayIcon)
			.setColor(0x5865f2) // Discord blurple
			.addFields(
				{
					name: "💰 Prix de départ",
					value: `\`${offer.startingPrice} coins\``,
					inline: true,
				},
				{
					name: "⏰ Ouverture",
					value: `<t:${Math.floor(offer.openingAt / 1000)}:F>`,
				},
				{
					name: "⏰ Fermeture",
					value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
				},
				{
					name: "Créée par",
					value: `<@${offer.sellerId}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""}`,
				},
			)
			.setTimestamp();
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferOpening(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const skin = await skinService.getSkin(offer.skinUuid);

	try {
		const discordUserSeller = await client.users.fetch(offer.sellerId);
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Début des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** viennent de commencer !`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "📌 Statut",
						value: `\`${offer.status}\``,
						inline: true,
					},
					{
						name: "💰 Prix de départ",
						value: `\`${offer.startingPrice} coins\``,
						inline: true,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
					},
					{
						name: "🆔 ID de l’offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}
	// Send notification in guild channel

	try {
		const guildChannel = await client.channels.fetch(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Début des enchères")
			.setDescription(
				`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** viennent de commencer !`,
			)
			.setThumbnail(skin.displayIcon)
			.setColor(0x5865f2) // Discord blurple
			.addFields(
				{
					name: "💰 Prix de départ",
					value: `\`${offer.startingPrice} coins\``,
					inline: true,
				},
				{
					name: "⏰ Fermeture",
					value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
				},
			)
			.setTimestamp();
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferClosing(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const skin = await skinService.getSkin(offer.skinUuid);
	const bids = await marketService.getOfferBids(offer.id);

	const discordUserSeller = await client.users.fetch(offer.sellerId);
	try {
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Fin des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** viennent de se terminer !`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.setTimestamp();

			if (bids.length === 0) {
				embed.addFields(
					{
						name: "❌ Aucune enchère n'a été placée sur cette offre.",
						value: "Tu conserves ce skin dans ton inventaire.",
					},
					{
						name: "🆔 ID de l’offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				);
			} else {
				const highestBid = bids[0];
				const highestBidderUser = await client.users.fetch(highestBid.bidderId);
				embed.addFields(
					{
						name: "✅ Enchères terminées avec succès !",
						value: `Ton skin a été vendu pour \`${highestBid.offerAmount} coins\` à <@${highestBid.bidderId}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
					},
					{
						name: "🆔 ID de l’offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				);
			}

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}

	// Send notification in guild channel

	try {
		const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID);
		const guildChannel = await guild.channels.fetch(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Fin des enchères")
			.setDescription(
				`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** viennent de se terminer !`,
			)
			.setThumbnail(skin.displayIcon)
			.setColor(0x5865f2) // Discord blurple
			.setTimestamp();

		if (bids.length === 0) {
			embed.addFields({
				name: "❌ Aucune enchère n'a été placée sur cette offre.",
				value: "",
			});
		} else {
			const highestBid = bids[0];
			const highestBidderUser = await client.users.fetch(highestBid.bidderId);
			embed.addFields({
				name: "✅ Enchères terminées avec succès !",
				value: `Le skin de <@${offer.sellerId}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""} a été vendu pour \`${highestBid.offerAmount} coins\` à <@${highestBid.bidderId}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
			});
			const discordUserBidder = await client.users.fetch(highestBid.bidderId);
			const userBidder = await userService.getUser(highestBid.bidderId);
			if (discordUserBidder && userBidder?.isAkhy) {
				const embed = new EmbedBuilder()
					.setTitle("🔔 Fin des enchères")
					.setDescription(
						`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** viennent de se terminer !`,
					)
					.setThumbnail(skin.displayIcon)
					.setColor(0x5865f2) // Discord blurple
					.setTimestamp();
				const highestBid = bids[0];
				embed.addFields({
					name: "✅ Enchères terminées avec succès !",
					value: `Tu as acheté ce skin pour \`${highestBid.offerAmount} coins\` à <@${offer.sellerId}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""}. Il a été ajouté à ton inventaire.`,
				});

				discordUserBidder.send({ embeds: [embed] }).catch(console.error);
			}
		}
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleNewMarketOfferBid(offerId, bidId, client) {
	// Notify Seller and Bidder
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const bid = (await marketService.getOfferBids(offerId))[0];
	if (!bid) return;
	const skin = await skinService.getSkin(offer.skinUuid);

	const bidderUser = client.users.fetch(bid.bidderId);
	try {
		const discordUserSeller = await client.users.fetch(offer.sellerId);
		const userSeller = await userService.getUser(offer.sellerId);

		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Il y a eu une nouvelle enchère sur ton offre pour le skin **${skin ? skin.displayName : offer.skinUuid}**.`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidderId}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l’enchère",
						value: `\`${bid.offerAmount} coins\``,
						inline: true,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
					},
					{
						name: "🆔 ID de l’offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(`Erreur lors de la notification du vendeur : ${e}`);
	}

	try {
		const discordUserNewBidder = await client.users.fetch(bid.bidderId);
		const userNewBidder = await userService.getUser(bid.bidderId);
		if (discordUserNewBidder && userNewBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Ton enchère sur l'offre pour le skin **${skin ? skin.displayName : offer.skinUuid}** a bien été placée!`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields({
					name: "💰 Montant de l’enchère",
					value: `\`${bid.offerAmount} coins\``,
					inline: true,
				})
				.setTimestamp();

			discordUserNewBidder.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(`Erreur lors de la notification de l'enchérriseur : ${e}`);
	}

	try {
		const offerBids = await marketService.getOfferBids(offer.id);
		if (offerBids.length < 2) return; // No previous bidder to notify

		const discordUserPreviousBidder = await client.users.fetch(offerBids[1].bidderId);
		const userPreviousBidder = await userService.getUser(offerBids[1].bidderId);
		if (discordUserPreviousBidder && userPreviousBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Quelqu'un a surenchéri sur l'offre pour le skin **${skin ? skin.displayName : offer.skinUuid}**, tu n'es plus le meilleur enchérisseur !`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidderId}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l’enchère",
						value: `\`${bid.offerAmount} coins\``,
						inline: true,
					},
				)
				.setTimestamp();

			discordUserPreviousBidder.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}

	// Notify previous highest bidder
}

export async function handleCaseOpening(caseType, userId, skinUuid, client) {
	const discordUser = await client.users.fetch(userId);
	const skin = await skinService.getSkin(skinUuid);
	try {
		const guildChannel = await client.channels.fetch(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Ouverture de caisse")
			.setDescription(
				`${discordUser ? discordUser.username : "Un utilisateur"} vient d'ouvrir une caisse **${caseType}** et a obtenu le skin **${skin.displayName}** !`,
			)
			.setThumbnail(skin.displayIcon)
			.setColor(skin.tierColor) // Discord blurple
			.addFields(
				{
					name: "💰 Valeur estimée",
					value: `\`${skin.currentPrice} coins\``,
					inline: true,
				},
				{
					name: "Level",
					value: `${skin.currentLvl}`,
				},
			)
			.setTimestamp();
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}
