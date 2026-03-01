import prisma from "../prisma/client.js";

function toOffer(offer) {
	return { ...offer, openingAt: Number(offer.openingAt), closingAt: Number(offer.closingAt) };
}

export async function getMarketOffers() {
	const offers = await prisma.marketOffer.findMany({ orderBy: { postedAt: "desc" } });
	return offers.map(toOffer);
}

export async function getMarketOfferById(id) {
	const offer = await prisma.marketOffer.findUnique({
		where: { id },
		include: {
			skin: { select: { displayName: true, displayIcon: true } },
			csSkin: { select: { displayName: true, imageUrl: true, rarity: true, wearState: true, float: true, isStattrak: true, isSouvenir: true } },
			seller: { select: { username: true, globalName: true } },
			buyer: { select: { username: true, globalName: true } },
		},
	});
	if (!offer) return null;
	const skinData = offer.csSkin || offer.skin;
	return toOffer({
		...offer,
		skinName: skinData?.displayName,
		skinIcon: offer.skin?.displayIcon || offer.csSkin?.imageUrl,
		sellerName: offer.seller?.username,
		sellerGlobalName: offer.seller?.globalName,
		buyerName: offer.buyer?.username ?? null,
		buyerGlobalName: offer.buyer?.globalName ?? null,
	});
}

export async function getMarketOffersBySkin(skinUuid) {
	const offers = await prisma.marketOffer.findMany({
		where: { skinUuid },
		include: {
			skin: { select: { displayName: true, displayIcon: true } },
			seller: { select: { username: true, globalName: true } },
			buyer: { select: { username: true, globalName: true } },
		},
	});
	return offers.map((offer) =>
		toOffer({
			...offer,
			skinName: offer.skin?.displayName,
			skinIcon: offer.skin?.displayIcon,
			sellerName: offer.seller?.username,
			sellerGlobalName: offer.seller?.globalName,
			buyerName: offer.buyer?.username ?? null,
			buyerGlobalName: offer.buyer?.globalName ?? null,
		}),
	);
}

export async function getMarketOffersByCsSkin(csSkinId) {
	const offers = await prisma.marketOffer.findMany({
		where: { csSkinId },
		include: {
			csSkin: { select: { displayName: true, imageUrl: true } },
			seller: { select: { username: true, globalName: true } },
			buyer: { select: { username: true, globalName: true } },
		},
	});
	return offers.map((offer) =>
		toOffer({
			...offer,
			skinName: offer.csSkin?.displayName,
			skinIcon: offer.csSkin?.imageUrl,
			sellerName: offer.seller?.username,
			sellerGlobalName: offer.seller?.globalName,
			buyerName: offer.buyer?.username ?? null,
			buyerGlobalName: offer.buyer?.globalName ?? null,
		}),
	);
}

export async function insertMarketOffer(data) {
	return prisma.marketOffer.create({
		data: {
			...data,
			openingAt: new Date(data.openingAt),
			closingAt: new Date(data.closingAt),
		},
	});
}

export async function updateMarketOffer(data) {
	const { id, ...rest } = data;
	return prisma.marketOffer.update({ where: { id }, data: rest });
}

export async function deleteMarketOffer(id) {
	return prisma.marketOffer.delete({ where: { id } });
}

// --- Bids ---

export async function getBids() {
	const bids = await prisma.bid.findMany({
		include: { bidder: { select: { username: true, globalName: true } } },
		orderBy: [{ offerAmount: "desc" }, { offeredAt: "asc" }],
	});
	return bids.map((bid) => ({
		...bid,
		bidderName: bid.bidder?.username,
		bidderGlobalName: bid.bidder?.globalName,
	}));
}

export async function getBidById(id) {
	return prisma.bid.findUnique({ where: { id } });
}

export async function getOfferBids(marketOfferId) {
	const bids = await prisma.bid.findMany({
		where: { marketOfferId },
		orderBy: [{ offerAmount: "desc" }, { offeredAt: "asc" }],
	});
	return bids.map((bid) => ({
		...bid,
	}));
}

export async function insertBid(data) {
	return prisma.bid.create({ data });
}

export async function deleteBid(id) {
	return prisma.bid.delete({ where: { id } });
}
