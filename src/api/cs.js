import { csSkinsData, csSkinsPrices } from "../utils/cs.state.js";

const params = new URLSearchParams({
	app_id: 730,
	currency: "EUR",
});

export const fetchSuggestedPrices = async () => {
	try {
		const response = await fetch(`https://api.skinport.com/v1/items?${params}`, {
			method: "GET",
			headers: { "Accept-Encoding": "br" },
		});
		const data = await response.json();
		data.forEach((skin) => {
			if (skin.market_hash_name) {
				csSkinsPrices[skin.market_hash_name] = {
					suggested_price: skin.suggested_price,
					min_price: skin.min_price,
					max_price: skin.max_price,
					mean_price: skin.mean_price,
					median_price: skin.median_price,
				};
			}
		});
		return data;
	} catch (error) {
		console.error("Error parsing JSON:", error);
		return null;
	}
};

export const fetchSkinsData = async () => {
	try {
		const response = await fetch(
			`https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json`,
		);
		const data = await response.json();
		data.forEach((skin) => {
			if (skin.market_hash_name) {
				csSkinsData[skin.market_hash_name] = skin;
			} else if (skin.name) {
				csSkinsData[skin.name] = skin;
			}
		});
		return data;
	} catch (error) {
		console.error("Error fetching skins data:", error);
		return null;
	}
};
