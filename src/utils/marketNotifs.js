import { getMarketOfferById, getOfferBids, getSkin, getUser } from "../database/index.js";
import { EmbedBuilder } from "discord.js";

export async function handleNewMarketOffer(offerId, client) {
	const offer = getMarketOfferById.get(offerId);
	if (!offer) return;
	const skin = getSkin.get(offer.skin_uuid);

	const discordUserSeller = await client.users.fetch(offer.seller_id);
	try {
		const userSeller = getUser.get(offer.seller_id);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Offre créée")
				.setDescription(`Ton offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** a bien été créée !`)
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
						value: `\`${offer.starting_price} coins\``,
						inline: true,
					},
					{
						name: "⏰ Ouverture",
						value: `<t:${Math.floor(offer.opening_at / 1000)}:F>`,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closing_at / 1000)}:F>`,
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
			.setDescription(`Une offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** a été créée !`)
			.setThumbnail(skin.displayIcon)
			.setColor(0x5865f2) // Discord blurple
			.addFields(
				{
					name: "💰 Prix de départ",
					value: `\`${offer.starting_price} coins\``,
					inline: true,
				},
				{
					name: "⏰ Ouverture",
					value: `<t:${Math.floor(offer.opening_at / 1000)}:F>`,
				},
				{
					name: "⏰ Fermeture",
					value: `<t:${Math.floor(offer.closing_at / 1000)}:F>`,
				},
				{
					name: "Créée par",
					value: `<@${offer.seller_id}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""}`,
				},
			)
			.setTimestamp();
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferOpening(offerId, client) {
	const offer = getMarketOfferById.get(offerId);
	if (!offer) return;
	const skin = getSkin.get(offer.skin_uuid);

	try {
		const discordUserSeller = await client.users.fetch(offer.seller_id);
		const userSeller = getUser.get(offer.seller_id);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Début des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** viennent de commencer !`,
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
						value: `\`${offer.starting_price} coins\``,
						inline: true,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closing_at / 1000)}:F>`,
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
				`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** viennent de commencer !`,
			)
			.setThumbnail(skin.displayIcon)
			.setColor(0x5865f2) // Discord blurple
			.addFields(
				{
					name: "💰 Prix de départ",
					value: `\`${offer.starting_price} coins\``,
					inline: true,
				},
				{
					name: "⏰ Fermeture",
					value: `<t:${Math.floor(offer.closing_at / 1000)}:F>`,
				},
			)
			.setTimestamp();
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferClosing(offerId, client) {
	const offer = getMarketOfferById.get(offerId);
	if (!offer) return;
	const skin = getSkin.get(offer.skin_uuid);
	const bids = getOfferBids.all(offer.id);

	const discordUserSeller = await client.users.fetch(offer.seller_id);
	try {
		const userSeller = getUser.get(offer.seller_id);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Fin des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** viennent de se terminer !`,
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
				const highestBidderUser = await client.users.fetch(highestBid.bidder_id);
				embed.addFields(
					{
						name: "✅ Enchères terminées avec succès !",
						value: `Ton skin a été vendu pour \`${highestBid.offer_amount} coins\` à <@${highestBid.bidder_id}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
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
				`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** viennent de se terminer !`,
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
			const highestBidderUser = await client.users.fetch(highestBid.bidder_id);
			embed.addFields({
				name: "✅ Enchères terminées avec succès !",
				value: `Le skin de <@${offer.seller_id}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""} a été vendu pour \`${highestBid.offer_amount} coins\` à <@${highestBid.bidder_id}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
			});
			const discordUserBidder = await client.users.fetch(highestBid.bidder_id);
			const userBidder = getUser.get(highestBid.bidder_id);
			if (discordUserBidder && userBidder?.isAkhy) {
				const embed = new EmbedBuilder()
					.setTitle("🔔 Fin des enchères")
					.setDescription(
						`Les enchères sur l'offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** viennent de se terminer !`,
					)
					.setThumbnail(skin.displayIcon)
					.setColor(0x5865f2) // Discord blurple
					.setTimestamp();
				const highestBid = bids[0];
				embed.addFields({
					name: "✅ Enchères terminées avec succès !",
					value: `Tu as acheté ce skin pour \`${highestBid.offer_amount} coins\` à <@${offer.seller_id}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""}. Il a été ajouté à ton inventaire.`,
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
	const offer = getMarketOfferById.get(offerId);
	if (!offer) return;
	const bid = getOfferBids.get(offerId);
	if (!bid) return;
	const skin = getSkin.get(offer.skin_uuid);

	const bidderUser = client.users.fetch(bid.bidder_id);
	try {
		const discordUserSeller = await client.users.fetch(offer.seller_id);
		const userSeller = getUser.get(offer.seller_id);

		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Il y a eu une nouvelle enchère sur ton offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}**.`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidder_id}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l’enchère",
						value: `\`${bid.offer_amount} coins\``,
						inline: true,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closing_at / 1000)}:F>`,
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
		const discordUserNewBidder = await client.users.fetch(bid.bidder_id);
		const userNewBidder = getUser.get(bid.bidder_id);
		if (discordUserNewBidder && userNewBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Ton enchère sur l'offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}** a bien été placée!`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields({
					name: "💰 Montant de l’enchère",
					value: `\`${bid.offer_amount} coins\``,
					inline: true,
				})
				.setTimestamp();

			discordUserNewBidder.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(`Erreur lors de la notification de l'enchérriseur : ${e}`);
	}

	try {
		const offerBids = getOfferBids.all(offer.id);
		if (offerBids.length < 2) return; // No previous bidder to notify

		const discordUserPreviousBidder = await client.users.fetch(offerBids[1].bidder_id);
		const userPreviousBidder = getUser.get(offerBids[1].bidder_id);
		if (discordUserPreviousBidder && userPreviousBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Quelqu'un a surenchéri sur l'offre pour le skin **${skin ? skin.displayName : offer.skin_uuid}**, tu n'es plus le meilleur enchérisseur !`,
				)
				.setThumbnail(skin.displayIcon)
				.setColor(0x5865f2) // Discord blurple
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidder_id}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l’enchère",
						value: `\`${bid.offer_amount} coins\``,
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
	const skin = getSkin.get(skinUuid);
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
