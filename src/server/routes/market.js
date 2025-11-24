import express from "express";

// --- Database Imports ---
// --- Game State Imports ---
// --- Utility and API Imports ---
// --- Discord.js Builder Imports ---
import { ButtonStyle } from "discord.js";
import { getMarketOfferById, getMarketOffers, getOfferBids, getSkin, getUser } from "../../database/index.js";

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
			// Placeholder for fetching bids logic
			const bids = getOfferBids.get(req.params.id);
			res.status(200).send({ bids });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.post("/place-offer", async (req, res) => {
		try {
			// Placeholder for placing an offer logic
			// Extract data from req.body and process accordingly
			res.status(200).send({ message: "Offer placed successfully" });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	router.post("/offers/:id/place-bid", async (req, res) => {
		try {
			// Placeholder for placing a bid logic
			// Extract data from req.body and process accordingly
			res.status(200).send({ message: "Bid placed successfully" });
		} catch (e) {
			res.status(500).send({ error: e });
		}
	});

	return router;
}
