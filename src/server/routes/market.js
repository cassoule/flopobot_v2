import express from "express";

// --- Database Imports ---
// --- Game State Imports ---
// --- Utility and API Imports ---
// --- Discord.js Builder Imports ---
import { ButtonStyle } from "discord.js";
import * as userService from "../../services/user.service.js";
import * as skinService from "../../services/skin.service.js";
import * as logService from "../../services/log.service.js";
import * as marketService from "../../services/market.service.js";
import * as csSkinService from "../../services/csSkin.service.js";
import { emitMarketUpdate } from "../socket.js";
import { handleNewMarketOffer, handleNewMarketOfferBid } from "../../utils/marketNotifs.js";
import { requireAuth } from "../middleware/auth.js";

// Create a new router instance
const router = express.Router();

/**
 * Factory function to create and configure the market routes.
 * @param {object} client - The Discord.js client instance.
 * @param {object} io - The Socket.IO server instance.
 * @returns {object} The configured Express router.
 */
export function marketRoutes(client, io) {
	router.get("/offers", async (req, res) => {
		try {
			const offers = await marketService.getMarketOffers();
			for (const offer of offers) {
				if (offer.csSkinId) {
					offer.csSkin = await csSkinService.getCsSkin(offer.csSkinId);
				} else if (offer.skinUuid) {
					offer.skin = await skinService.getSkin(offer.skinUuid);
				}
				offer.seller = await userService.getUser(offer.sellerId);
				offer.buyer = offer.buyerId ? await userService.getUser(offer.buyerId) : null;
				offer.bids = (await marketService.getOfferBids(offer.id)) || {};
				for (const bid of offer.bids) {
					bid.bidder = await userService.getUser(bid.bidderId);
				}
			}
			res.status(200).send({ offers });
		} catch (e) {
			console.log(e);
			res.status(500).send({ error: e });
		}
	});

	router.get("/offers/:id", async (req, res) => {
		try {
			const offer = await marketService.getMarketOfferById(req.params.id);
			if (offer) {
				res.status(200).send({ offer });
			} else {
				res.status(404).send({ error: "Offer not found" });
			}
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.get("/offers/:id/bids", async (req, res) => {
		try {
			const bids = await marketService.getOfferBids(req.params.id);
			res.status(200).send({ bids });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.post("/place-offer", requireAuth, async (req, res) => {
		const seller_id = req.userId;
		const { skin_uuid, cs_skin_id, starting_price, delay, duration, timestamp } = req.body;
		const now = Date.now();
		try {
			const seller = await userService.getUser(seller_id);
			if (!seller) return res.status(404).send({ error: "Seller not found" });

			let skinRef; // { skinUuid, csSkinId } - one or the other
			if (cs_skin_id) {
				const csSkin = await csSkinService.getCsSkin(cs_skin_id);
				if (!csSkin) return res.status(404).send({ error: "CS skin not found" });
				if (csSkin.userId !== seller.id) return res.status(403).send({ error: "You do not own this skin" });
				if (csSkin.loadoutSlot !== null)
					return res.status(403).send({ error: "Retirez d'abord ce skin de votre équipement." });
				skinRef = { csSkinId: csSkin.id };
			} else if (skin_uuid) {
				const skin = await skinService.getSkin(skin_uuid);
				if (!skin) return res.status(404).send({ error: "Skin not found" });
				if (skin.userId !== seller.id) return res.status(403).send({ error: "You do not own this skin" });
				skinRef = { skinUuid: skin.uuid };
			} else {
				return res.status(400).send({ error: "Must provide skin_uuid or cs_skin_id" });
			}

			const existingOffers = skinRef.skinUuid
				? await marketService.getMarketOffersBySkin(skinRef.skinUuid)
				: await marketService.getMarketOffersByCsSkin(skinRef.csSkinId);
			if (
				existingOffers.length > 0 &&
				existingOffers.some((offer) => offer.status === "open" || offer.status === "pending")
			) {
				return res.status(403).send({ error: "This skin already has an open or pending offer." });
			}

			const opening_at = now + delay;
			const closing_at = opening_at + duration;

			const offerId = Date.now() + "-" + seller.id + "-" + (skinRef.skinUuid || skinRef.csSkinId);
			await marketService.insertMarketOffer({
				id: offerId,
				skinUuid: skinRef.skinUuid || null,
				csSkinId: skinRef.csSkinId || null,
				sellerId: seller.id,
				startingPrice: starting_price,
				buyoutPrice: null,
				status: delay > 0 ? "pending" : "open",
				openingAt: opening_at,
				closingAt: closing_at,
			});
			await emitMarketUpdate();
			await handleNewMarketOffer(offerId, client);
			res.status(200).send({ message: "Offre créée avec succès" });
		} catch (e) {
			console.log(e);
			return res.status(500).send({ error: e });
		}
	});

	router.post("/offers/:id/place-bid", requireAuth, async (req, res) => {
		const buyer_id = req.userId;
		const { bid_amount, timestamp } = req.body;
		try {
			const offer = await marketService.getMarketOfferById(req.params.id);
			if (!offer) return res.status(404).send({ error: "Offer not found" });
			if (offer.closingAt < timestamp) return res.status(403).send({ error: "Bidding period has ended" });

			if (buyer_id === offer.sellerId) return res.status(403).send({ error: "You can't bid on your own offer" });

			const offerBids = await marketService.getOfferBids(offer.id);
			const lastBid = offerBids[0];

			if (lastBid) {
				if (lastBid?.bidderId === buyer_id)
					return res.status(403).send({ error: "You are already the highest bidder" });
				if (bid_amount < lastBid?.offerAmount + 1) {
					return res.status(403).send({ error: "Bid amount is below minimum" });
				}
			} else {
				if (bid_amount < offer.startingPrice + 1) {
					return res.status(403).send({ error: "Bid amount is below minimum" });
				}
			}

			const bidder = await userService.getUser(buyer_id);
			if (!bidder) return res.status(404).send({ error: "Bidder not found" });
			if (bidder.coins < bid_amount)
				return res.status(403).send({ error: "You do not have enough coins to place this bid" });

			const bidId = Date.now() + "-" + buyer_id + "-" + offer.id;
			await marketService.insertBid({
				id: bidId,
				bidderId: buyer_id,
				marketOfferId: offer.id,
				offerAmount: bid_amount,
			});
			const newCoinsAmount = bidder.coins - bid_amount;
			await userService.updateUserCoins(buyer_id, newCoinsAmount);
			await logService.insertLog({
				id: `${buyer_id}-bid-${offer.id}-${Date.now()}`,
				userId: buyer_id,
				action: "BID_PLACED",
				targetUserId: null,
				coinsAmount: bid_amount,
				userNewAmount: newCoinsAmount,
			});

			// Refund the previous highest bidder
			if (lastBid) {
				const previousBidder = await userService.getUser(lastBid.bidderId);
				const refundedCoinsAmount = previousBidder.coins + lastBid.offerAmount;
				await userService.updateUserCoins(previousBidder.id, refundedCoinsAmount);
				await logService.insertLog({
					id: `${previousBidder.id}-bid-refund-${offer.id}-${Date.now()}`,
					userId: previousBidder.id,
					action: "BID_REFUNDED",
					targetUserId: null,
					coinsAmount: lastBid.offerAmount,
					userNewAmount: refundedCoinsAmount,
				});
			}

			await handleNewMarketOfferBid(offer.id, bidId, client);
			await emitMarketUpdate();
			res.status(200).send({ error: "Bid placed successfully" });
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
			res.status(500).send({ error: e });
		}
	});

	return router;
}
