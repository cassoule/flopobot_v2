import express from "express";

// --- Database Imports ---
// --- Game State Imports ---
// --- Utility and API Imports ---
// --- Discord.js Builder Imports ---
import { ButtonStyle } from "discord.js";
import {
	getMarketOfferById,
	getMarketOffers,
	getOfferBids,
	getSkin,
	getUser,
	insertBid,
	insertLog,
	insertMarketOffer,
	updateUserCoins,
} from "../../database/index.js";
import { emitMarketUpdate } from "../socket.js";

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
			const offers = getMarketOffers.all();
			offers.forEach((offer) => {
				offer.skin = getSkin.get(offer.skin_uuid);
				offer.seller = getUser.get(offer.seller_id);
				offer.buyer = getUser.get(offer.buyer_id) || null;
				offer.bids = getOfferBids.all(offer.id) || {};
				offer.bids.forEach((bid) => {
					bid.bidder = getUser.get(bid.bidder_id);
				});
			});
			res.status(200).send({ offers });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.get("/offers/:id", async (req, res) => {
		try {
			const offer = getMarketOfferById.get(req.params.id);
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
			const bids = getOfferBids.get(req.params.id);
			res.status(200).send({ bids });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.post("/place-offer", async (req, res) => {
		const { seller_id, skin_uuid, starting_price, delay, duration, timestamp } = req.body;
		const now = Date.now();
		try {
			const skin = getSkin.get(skin_uuid);
			if (!skin) return res.status(404).send({ error: "Skin not found" });
			const seller = getUser.get(seller_id);
			if (!seller) return res.status(404).send({ error: "Seller not found" });
			if (skin.user_id !== seller.id) return res.status(403).send({ error: "You do not own this skin" });

			const opening_at = now + delay;
			const closing_at = opening_at + duration;

			insertMarketOffer.run({
				id: Date.now() + '-' + seller.id + '-' + skin.uuid,
				skin_uuid: skin.uuid,
				seller_id: seller.id,
				starting_price: starting_price,
				buyout_price: null,
				status: delay > 0 ? "pending" : "open",
				opening_at: opening_at,
				closing_at: closing_at,
			});
			// Placeholder for placing an offer logic
			// Extract data from req.body and process accordingly
			await emitMarketUpdate();
			res.status(200).send({ message: "Offre créée avec succès" });
		} catch (e) {
			console.log(e)
			return res.status(500).send({ error: e });
		}
	});

	router.post("/offers/:id/place-bid", async (req, res) => {
		const { buyer_id, bid_amount, timestamp } = req.body;
		try {
			const offer = getMarketOfferById.get(req.params.id);
			if (!offer) return res.status(404).send({ error: "Offer not found" });
			if (offer.closing_at < timestamp) return res.status(403).send({ error: "Bidding period has ended" });

			if (buyer_id === offer.seller_id) return res.status(403).send({ error: "You can't bid on your own offer" });

			const offerBids = getOfferBids.all(offer.id);
			const lastBid = offerBids[0];

			if (lastBid) {
				if (lastBid?.bidder_id === buyer_id)
					return res.status(403).send({ error: "You are already the highest bidder" });
				if (bid_amount < lastBid?.offer_amount + 10) {
					return res.status(403).send({ error: "Bid amount is below minimum" });
				}
			} else {
				if (bid_amount < offer.starting_price + 10) {
					return res.status(403).send({ error: "Bid amount is below minimum" });
				}
			}

			const bidder = getUser.get(buyer_id);
			if (!bidder) return res.status(404).send({ error: "Bidder not found" });
			if (bidder.coins < bid_amount)
				return res.status(403).send({ error: "You do not have enough coins to place this bid" });

			insertBid.run({
				id: Date.now(),
				bidder_id: buyer_id,
				market_offer_id: offer.id,
				offer_amount: bid_amount,
			});
			const newCoinsAmount = bidder.coins - bid_amount;
			updateUserCoins.run({ id: buyer_id, coins: newCoinsAmount });
			insertLog.run({
				id: `${buyer_id}-bid-${offer.id}-${Date.now()}`,
				user_id: buyer_id,
				action: "BID_PLACED",
				target_user_id: null,
				coins_amount: bid_amount,
				user_new_amount: newCoinsAmount,
			});

			// Refund the previous highest bidder
			if (lastBid) {
				const previousBidder = getUser.get(lastBid.bidder_id);
				const refundedCoinsAmount = previousBidder.coins + lastBid.offer_amount;
				updateUserCoins.run({ id: previousBidder.id, coins: refundedCoinsAmount });
				insertLog.run({
					id: `${previousBidder.id}-bid-refund-${offer.id}-${Date.now()}`,
					user_id: previousBidder.id,
					action: "BID_REFUNDED",
					target_user_id: null,
					coins_amount: lastBid.offer_amount,
					user_new_amount: refundedCoinsAmount,
				});
			}

			await emitMarketUpdate();
			res.status(200).send({ error: "Bid placed successfully" });
		} catch (e) {
			console.log(`[${Date.now()}]`, e);
			res.status(500).send({ error: e });
		}
	});

	return router;
}
