import Database from "better-sqlite3";

export const flopoDB = new Database("flopobot.db");

export const stmtUsers = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS users
    (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL,
        globalName    TEXT,
        warned        BOOLEAN DEFAULT 0,
        warns         INTEGER DEFAULT 0,
        allTimeWarns  INTEGER DEFAULT 0,
        totalRequests INTEGER DEFAULT 0,
        coins         INTEGER DEFAULT 0,
        dailyQueried  BOOLEAN DEFAULT 0,
        avatarUrl     TEXT    DEFAULT NULL,
        isAkhy        BOOLEAN DEFAULT 0
    )
`);
stmtUsers.run();
export const stmtSkins = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS skins
    (
        uuid            TEXT PRIMARY KEY,
        displayName     TEXT,
        contentTierUuid TEXT,
        displayIcon     TEXT,
        user_id         TEXT REFERENCES users,
        tierRank        TEXT,
        tierColor       TEXT,
        tierText        TEXT,
        basePrice       TEXT,
        currentLvl      INTEGER DEFAULT NULL,
        currentChroma   INTEGER DEFAULT NULL,
        currentPrice    INTEGER DEFAULT NULL,
        maxPrice        INTEGER DEFAULT NULL
    )
`);
stmtSkins.run();

export const insertUser = flopoDB.prepare(
	`INSERT INTO users (id, username, globalName, warned, warns, allTimeWarns, totalRequests, avatarUrl, isAkhy)
   VALUES (@id, @username, @globalName, @warned, @warns, @allTimeWarns, @totalRequests, @avatarUrl, @isAkhy)`,
);
export const updateUser = flopoDB.prepare(
	`UPDATE users
   SET warned        = @warned,
       warns         = @warns,
       allTimeWarns  = @allTimeWarns,
       totalRequests = @totalRequests
   WHERE id = @id`,
);
export const updateUserAvatar = flopoDB.prepare("UPDATE users SET avatarUrl = @avatarUrl WHERE id = @id");
export const queryDailyReward = flopoDB.prepare(`UPDATE users
                                                 SET dailyQueried = 1
                                                 WHERE id = ?`);
export const resetDailyReward = flopoDB.prepare(`UPDATE users
                                                 SET dailyQueried = 0`);
export const updateUserCoins = flopoDB.prepare("UPDATE users SET coins = @coins WHERE id = @id");
export const getUser = flopoDB.prepare(
	"SELECT users.*,elos.elo FROM users LEFT JOIN elos ON elos.id = users.id WHERE users.id = ?",
);
export const getAllUsers = flopoDB.prepare(
	"SELECT users.*,elos.elo FROM users LEFT JOIN elos ON elos.id = users.id ORDER BY coins DESC",
);
export const getAllAkhys = flopoDB.prepare(
	"SELECT users.*,elos.elo FROM users LEFT JOIN elos ON elos.id = users.id WHERE isAkhy = 1 ORDER BY coins DESC",
);

export const insertSkin = flopoDB.prepare(
	`INSERT INTO skins (uuid, displayName, contentTierUuid, displayIcon, user_id, tierRank, tierColor, tierText,
                      basePrice, currentLvl, currentChroma, currentPrice, maxPrice)
   VALUES (@uuid, @displayName, @contentTierUuid, @displayIcon, @user_id, @tierRank, @tierColor, @tierText,
           @basePrice, @currentLvl, @currentChroma, @currentPrice, @maxPrice)`,
);
export const updateSkin = flopoDB.prepare(
	`UPDATE skins
   SET user_id       = @user_id,
       currentLvl    = @currentLvl,
       currentChroma = @currentChroma,
       currentPrice  = @currentPrice
   WHERE uuid = @uuid`,
);
export const hardUpdateSkin = flopoDB.prepare(
	`UPDATE skins
   SET displayName     = @displayName,
       contentTierUuid = @contentTierUuid,
       displayIcon     = @displayIcon,
       tierRank        = @tierRank,
       tierColor       = @tierColor,
       tierText        = @tierText,
       basePrice       = @basePrice,
       user_id         = @user_id,
       currentLvl      = @currentLvl,
       currentChroma   = @currentChroma,
       currentPrice    = @currentPrice,
       maxPrice        = @maxPrice
   WHERE uuid = @uuid`,
);
export const getSkin = flopoDB.prepare("SELECT * FROM skins WHERE uuid = ?");
export const getAllSkins = flopoDB.prepare("SELECT * FROM skins ORDER BY maxPrice DESC");
export const getAllAvailableSkins = flopoDB.prepare("SELECT * FROM skins WHERE user_id IS NULL");
export const getUserInventory = flopoDB.prepare(
	"SELECT * FROM skins WHERE user_id = @user_id ORDER BY currentPrice DESC",
);
export const getTopSkins = flopoDB.prepare("SELECT * FROM skins ORDER BY maxPrice DESC LIMIT 10");

export const stmtMarketOffers = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS market_offers
    (
        id PRIMARY KEY,
        skin_uuid      TEXT REFERENCES skins,
        seller_id      TEXT REFERENCES users,
        starting_price INTEGER   NOT NULL,
        buyout_price   INTEGER               DEFAULT NULL,
        final_price    INTEGER               DEFAULT NULL,
        status         TEXT      NOT NULL,
        posted_at      TIMESTAMP             DEFAULT CURRENT_TIMESTAMP,
        opening_at     TIMESTAMP NOT NULL,
        closing_at     TIMESTAMP NOT NULL,
        buyer_id       TEXT REFERENCES users DEFAULT NULL
    )
`);
stmtMarketOffers.run();

export const stmtBids = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS bids
    (
        id PRIMARY KEY,
        bidder_id    TEXT REFERENCES users,
        market_offer_id REFERENCES market_offers,
        offer_amount INTEGER,
        offered_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);
stmtBids.run();

export const getMarketOffers = flopoDB.prepare(`
    SELECT *
    FROM market_offers
    ORDER BY market_offers.posted_at DESC
`);

export const getMarketOfferById = flopoDB.prepare(`
    SELECT market_offers.*,
           skins.displayName AS skinName,
           skins.displayIcon AS skinIcon,
           seller.username   AS sellerName,
           seller.globalName AS sellerGlobalName,
           buyer.username    AS buyerName,
           buyer.globalName  AS buyerGlobalName
    FROM market_offers
             JOIN skins ON skins.uuid = market_offers.skin_uuid
             JOIN users AS seller ON seller.id = market_offers.seller_id
             LEFT JOIN users AS buyer ON buyer.id = market_offers.buyer_id
    WHERE market_offers.id = ?
`);

export const getMarketOffersBySkin = flopoDB.prepare(`
    SELECT market_offers.*,
           skins.displayName AS skinName,
           skins.displayIcon AS skinIcon,
           seller.username   AS sellerName,
           seller.globalName AS sellerGlobalName,
           buyer.username    AS buyerName,
           buyer.globalName  AS buyerGlobalName
    FROM market_offers
             JOIN skins ON skins.uuid = market_offers.skin_uuid
             JOIN users AS seller ON seller.id = market_offers.seller_id
             LEFT JOIN users AS buyer ON buyer.id = market_offers.buyer_id
    WHERE market_offers.skin_uuid = ?
`);

export const insertMarketOffer = flopoDB.prepare(`
    INSERT INTO market_offers (id, skin_uuid, seller_id, starting_price, buyout_price, status, opening_at, closing_at)
    VALUES (@id, @skin_uuid, @seller_id, @starting_price, @buyout_price, @status, @opening_at, @closing_at)
`);

export const getBids = flopoDB.prepare(`
    SELECT bids.*,
           bidder.username   AS bidderName,
           bidder.globalName AS bidderGlobalName
    FROM bids
             JOIN users AS bidder ON bidder.id = bids.bidder_id
    ORDER BY bids.offer_amount DESC, bids.offered_at ASC
`);

export const getBidById = flopoDB.prepare(`
    SELECT bids.*
    FROM bids
    WHERE bids.id = ?
`);

export const getOfferBids = flopoDB.prepare(`
    SELECT bids.*
    FROM bids
    WHERE bids.market_offer_id = ?
    ORDER BY bids.offer_amount DESC, bids.offered_at ASC
`);

export const insertBid = flopoDB.prepare(`
    INSERT INTO bids (bidder_id, market_offer_id, offer_amount)
    VALUES (@bidder_id, @market_offer_id, @offer_amount)
`);

export const insertManyUsers = flopoDB.transaction(async (users) => {
	for (const user of users)
		try {
			await insertUser.run(user);
		} catch (e) {}
});
export const updateManyUsers = flopoDB.transaction(async (users) => {
	for (const user of users)
		try {
			await updateUser.run(user);
		} catch (e) {
			console.log("user update failed");
		}
});

export const insertManySkins = flopoDB.transaction(async (skins) => {
	for (const skin of skins)
		try {
			await insertSkin.run(skin);
		} catch (e) {}
});
export const updateManySkins = flopoDB.transaction(async (skins) => {
	for (const skin of skins)
		try {
			await updateSkin.run(skin);
		} catch (e) {}
});

export const stmtLogs = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS logs
    (
        id PRIMARY KEY,
        user_id         TEXT REFERENCES users,
        action          TEXT,
        target_user_id  TEXT REFERENCES users,
        coins_amount    INTEGER,
        user_new_amount INTEGER,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);
stmtLogs.run();

export const insertLog = flopoDB.prepare(
	`INSERT INTO logs (id, user_id, action, target_user_id, coins_amount, user_new_amount)
   VALUES (@id, @user_id, @action, @target_user_id, @coins_amount, @user_new_amount)`,
);
export const getLogs = flopoDB.prepare("SELECT * FROM logs");
export const getUserLogs = flopoDB.prepare("SELECT * FROM logs WHERE user_id = @user_id");

export const stmtGames = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS games
    (
        id PRIMARY KEY,
        p1         TEXT REFERENCES users,
        p2         TEXT REFERENCES users,
        p1_score   INTEGER,
        p2_score   INTEGER,
        p1_elo     INTEGER,
        p2_elo     INTEGER,
        p1_new_elo INTEGER,
        p2_new_elo INTEGER,
        type       TEXT,
        timestamp  TIMESTAMP
    )
`);
stmtGames.run();

export const insertGame = flopoDB.prepare(
	`INSERT INTO games (id, p1, p2, p1_score, p2_score, p1_elo, p2_elo, p1_new_elo, p2_new_elo, type, timestamp)
   VALUES (@id, @p1, @p2, @p1_score, @p2_score, @p1_elo, @p2_elo, @p1_new_elo, @p2_new_elo, @type, @timestamp)`,
);
export const getGames = flopoDB.prepare("SELECT * FROM games");
export const getUserGames = flopoDB.prepare(
	"SELECT * FROM games WHERE p1 = @user_id OR p2 = @user_id ORDER BY timestamp",
);

export const stmtElos = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS elos
    (
        id PRIMARY KEY REFERENCES users,
        elo INTEGER
    )
`);
stmtElos.run();

export const insertElos = flopoDB.prepare(`INSERT INTO elos (id, elo)
                                           VALUES (@id, @elo)`);
export const getElos = flopoDB.prepare(`SELECT *
                                        FROM elos`);
export const getUserElo = flopoDB.prepare(`SELECT *
                                           FROM elos
                                           WHERE id = @id`);
export const updateElo = flopoDB.prepare("UPDATE elos SET elo = @elo WHERE id = @id");

export const getUsersByElo = flopoDB.prepare(
	"SELECT * FROM users JOIN elos ON elos.id = users.id ORDER BY elos.elo DESC",
);

export const stmtSOTD = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS sotd
    (
        id              INT PRIMARY KEY,
        tableauPiles    TEXT,
        foundationPiles TEXT,
        stockPile       TEXT,
        wastePile       TEXT,
        isDone          BOOLEAN DEFAULT false,
        seed            TEXT
    )
`);
stmtSOTD.run();

export const getSOTD = flopoDB.prepare(`SELECT *
                                        FROM sotd
                                        WHERE id = '0'`);
export const insertSOTD =
	flopoDB.prepare(`INSERT INTO sotd (id, tableauPiles, foundationPiles, stockPile, wastePile, seed)
                   VALUES (0, @tableauPiles, @foundationPiles, @stockPile, @wastePile, @seed)`);
export const deleteSOTD = flopoDB.prepare(`DELETE
                                           FROM sotd
                                           WHERE id = '0'`);

export const stmtSOTDStats = flopoDB.prepare(`
    CREATE TABLE IF NOT EXISTS sotd_stats
    (
        id      TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users,
        time    INTEGER,
        moves   INTEGER,
        score   INTEGER
    )
`);
stmtSOTDStats.run();

export const getAllSOTDStats = flopoDB.prepare(`SELECT sotd_stats.*, users.globalName
                                                FROM sotd_stats
                                                         JOIN users ON users.id = sotd_stats.user_id
                                                ORDER BY score DESC, moves ASC, time ASC`);
export const getUserSOTDStats = flopoDB.prepare(`SELECT *
                                                 FROM sotd_stats
                                                 WHERE user_id = ?`);
export const insertSOTDStats = flopoDB.prepare(`INSERT INTO sotd_stats (id, user_id, time, moves, score)
                                                VALUES (@id, @user_id, @time, @moves, @score)`);
export const clearSOTDStats = flopoDB.prepare(`DELETE
                                               FROM sotd_stats`);
export const deleteUserSOTDStats = flopoDB.prepare(`DELETE
                                                    FROM sotd_stats
                                                    WHERE user_id = ?`);

export async function pruneOldLogs() {
	const users = flopoDB
		.prepare(
			`
          SELECT user_id
          FROM logs
          GROUP BY user_id
          HAVING COUNT(*) > ${process.env.LOGS_BY_USER}
			`,
		)
		.all();

	const transaction = flopoDB.transaction(() => {
		for (const { user_id } of users) {
			flopoDB
				.prepare(
					`
              DELETE
              FROM logs
              WHERE id IN (SELECT id
                           FROM (SELECT id,
                                        ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
                                 FROM logs
                                 WHERE user_id = ?)
                           WHERE rn > ${process.env.LOGS_BY_USER})
					`,
				)
				.run(user_id);
		}
	});

	transaction();
}
