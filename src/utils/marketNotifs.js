import * as userService from "../services/user.service.js";
import * as skinService from "../services/skin.service.js";
import * as csSkinService from "../services/csSkin.service.js";
import * as marketService from "../services/market.service.js";
import { EmbedBuilder } from "discord.js";
import { resolveUser } from "./index.js";

/**
 * Gets the skin display name and icon from an offer, supporting both Valorant and CS2 skins.
 */
async function getOfferSkinInfo(offer) {
	if (offer.csSkinId) {
		const csSkin = await csSkinService.getCsSkin(offer.csSkinId);
		return { name: csSkin?.displayName || offer.csSkinId, icon: csSkin?.imageUrl || null };
	}
	if (offer.skinUuid) {
		const skin = await skinService.getSkin(offer.skinUuid);
		return { name: skin?.displayName || offer.skinUuid, icon: skin?.displayIcon || null };
	}
	return { name: "Unknown", icon: null };
}

export async function handleNewMarketOffer(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const { name: skinName, icon: skinIcon } = await getOfferSkinInfo(offer);

	const discordUserSeller = await resolveUser(client, offer.sellerId);
	try {
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Offre créée")
				.setDescription(`Ton offre pour le skin **${skinName}** a bien été créée !`)
				.setColor(0x5865f2)
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
						name: "🆔 ID de l'offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}

	try {
		const guildChannel = client.channels.cache.get(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Nouvelle offre")
			.setDescription(`Une offre pour le skin **${skinName}** a été créée !`)
			.setColor(0x5865f2)
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
		if (skinIcon) embed.setThumbnail(skinIcon);
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferOpening(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const { name: skinName, icon: skinIcon } = await getOfferSkinInfo(offer);

	try {
		const discordUserSeller = await resolveUser(client, offer.sellerId);
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Début des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skinName}** viennent de commencer !`,
				)
				.setColor(0x5865f2)
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
						name: "🆔 ID de l'offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}

	try {
		const guildChannel = client.channels.cache.get(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Début des enchères")
			.setDescription(
				`Les enchères sur l'offre pour le skin **${skinName}** viennent de commencer !`,
			)
			.setColor(0x5865f2)
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
		if (skinIcon) embed.setThumbnail(skinIcon);
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleMarketOfferClosing(offerId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const { name: skinName, icon: skinIcon } = await getOfferSkinInfo(offer);
	const bids = await marketService.getOfferBids(offer.id);

	const discordUserSeller = await resolveUser(client, offer.sellerId);
	try {
		const userSeller = await userService.getUser(offer.sellerId);
		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Fin des enchères")
				.setDescription(
					`Les enchères sur ton offre pour le skin **${skinName}** viennent de se terminer !`,
				)
				.setColor(0x5865f2)
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			if (bids.length === 0) {
				embed.addFields(
					{
						name: "❌ Aucune enchère n'a été placée sur cette offre.",
						value: "Tu conserves ce skin dans ton inventaire.",
					},
					{
						name: "🆔 ID de l'offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				);
			} else {
				const highestBid = bids[0];
				const highestBidderUser = await resolveUser(client, highestBid.bidderId);
				embed.addFields(
					{
						name: "✅ Enchères terminées avec succès !",
						value: `Ton skin a été vendu pour \`${highestBid.offerAmount} coins\` à <@${highestBid.bidderId}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
					},
					{
						name: "🆔 ID de l'offre",
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

	try {
		const guild = client.guilds.cache.get(process.env.GUILD_ID);
		const guildChannel = guild.channels.cache.get(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Fin des enchères")
			.setDescription(
				`Les enchères sur l'offre pour le skin **${skinName}** viennent de se terminer !`,
			)
			.setColor(0x5865f2)
			.setTimestamp();
		if (skinIcon) embed.setThumbnail(skinIcon);

		if (bids.length === 0) {
			embed.addFields({
				name: "❌ Aucune enchère n'a été placée sur cette offre.",
				value: "",
			});
		} else {
			const highestBid = bids[0];
			const highestBidderUser = await resolveUser(client, highestBid.bidderId);
			embed.addFields({
				name: "✅ Enchères terminées avec succès !",
				value: `Le skin de <@${offer.sellerId}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""} a été vendu pour \`${highestBid.offerAmount} coins\` à <@${highestBid.bidderId}> ${highestBidderUser ? "(" + highestBidderUser.username + ")" : ""}.`,
			});
			const discordUserBidder = await resolveUser(client, highestBid.bidderId);
			const userBidder = await userService.getUser(highestBid.bidderId);
			if (discordUserBidder && userBidder?.isAkhy) {
				const bidderEmbed = new EmbedBuilder()
					.setTitle("🔔 Fin des enchères")
					.setDescription(
						`Les enchères sur l'offre pour le skin **${skinName}** viennent de se terminer !`,
					)
					.setColor(0x5865f2)
					.setTimestamp();
				if (skinIcon) bidderEmbed.setThumbnail(skinIcon);
				bidderEmbed.addFields({
					name: "✅ Enchères terminées avec succès !",
					value: `Tu as acheté ce skin pour \`${highestBid.offerAmount} coins\` à <@${offer.sellerId}> ${discordUserSeller ? "(" + discordUserSeller.username + ")" : ""}. Il a été ajouté à ton inventaire.`,
				});

				discordUserBidder.send({ embeds: [bidderEmbed] }).catch(console.error);
			}
		}
		guildChannel.send({ embeds: [embed] }).catch(console.error);
	} catch (e) {
		console.error(e);
	}
}

export async function handleNewMarketOfferBid(offerId, bidId, client) {
	const offer = await marketService.getMarketOfferById(offerId);
	if (!offer) return;
	const bid = (await marketService.getOfferBids(offerId))[0];
	if (!bid) return;
	const { name: skinName, icon: skinIcon } = await getOfferSkinInfo(offer);

	const bidderUser = await resolveUser(client, bid.bidderId);
	try {
		const discordUserSeller = await resolveUser(client, offer.sellerId);
		const userSeller = await userService.getUser(offer.sellerId);

		if (discordUserSeller && userSeller?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Il y a eu une nouvelle enchère sur ton offre pour le skin **${skinName}**.`,
				)
				.setColor(0x5865f2)
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidderId}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l'enchère",
						value: `\`${bid.offerAmount} coins\``,
						inline: true,
					},
					{
						name: "⏰ Fermeture",
						value: `<t:${Math.floor(offer.closingAt / 1000)}:F>`,
					},
					{
						name: "🆔 ID de l'offre",
						value: `\`${offer.id}\``,
						inline: false,
					},
				)
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			discordUserSeller.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(`Erreur lors de la notification du vendeur : ${e}`);
	}

	try {
		const discordUserNewBidder = await resolveUser(client, bid.bidderId);
		const userNewBidder = await userService.getUser(bid.bidderId);
		if (discordUserNewBidder && userNewBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Ton enchère sur l'offre pour le skin **${skinName}** a bien été placée!`,
				)
				.setColor(0x5865f2)
				.addFields({
					name: "💰 Montant de l'enchère",
					value: `\`${bid.offerAmount} coins\``,
					inline: true,
				})
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			discordUserNewBidder.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(`Erreur lors de la notification de l'enchérriseur : ${e}`);
	}

	try {
		const offerBids = await marketService.getOfferBids(offer.id);
		if (offerBids.length < 2) return;

		const discordUserPreviousBidder = await resolveUser(client, offerBids[1].bidderId);
		const userPreviousBidder = await userService.getUser(offerBids[1].bidderId);
		if (discordUserPreviousBidder && userPreviousBidder?.isAkhy) {
			const embed = new EmbedBuilder()
				.setTitle("🔔 Nouvelle enchère")
				.setDescription(
					`Quelqu'un a surenchéri sur l'offre pour le skin **${skinName}**, tu n'es plus le meilleur enchérisseur !`,
				)
				.setColor(0x5865f2)
				.addFields(
					{
						name: "👤 Enchérisseur",
						value: `<@${bid.bidderId}> ${bidderUser ? "(" + bidderUser.username + ")" : ""}`,
						inline: true,
					},
					{
						name: "💰 Montant de l'enchère",
						value: `\`${bid.offerAmount} coins\``,
						inline: true,
					},
				)
				.setTimestamp();
			if (skinIcon) embed.setThumbnail(skinIcon);

			discordUserPreviousBidder.send({ embeds: [embed] }).catch(console.error);
		}
	} catch (e) {
		console.error(e);
	}
}

export async function handleCaseOpening(caseType, userId, skinUuid, client) {
	const discordUser = await resolveUser(client, userId);
	const skin = await skinService.getSkin(skinUuid);
	try {
		const guildChannel = client.channels.cache.get(process.env.BOT_CHANNEL_ID);
		const embed = new EmbedBuilder()
			.setTitle("🔔 Ouverture de caisse")
			.setDescription(
				`${discordUser ? discordUser.username : "Un utilisateur"} vient d'ouvrir une caisse **${caseType}** et a obtenu le skin **${skin.displayName}** !`,
			)
			.setThumbnail(skin.displayIcon)
			.setColor(skin.tierColor)
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
