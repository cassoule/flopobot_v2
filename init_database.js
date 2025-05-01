import Database from "better-sqlite3";


export const flopoDB = new Database('flopobot.db');

export const stmtUsers = flopoDB.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    globalName TEXT,
    warned BOOLEAN DEFAULT 0,
    warns INTEGER DEFAULT 0,
    allTimeWarns INTEGER DEFAULT 0,
    totalRequests INTEGER DEFAULT 0
  )
`);
stmtUsers.run();
export const stmtSkins = flopoDB.prepare(`
  CREATE TABLE IF NOT EXISTS skins (
    uuid TEXT PRIMARY KEY,
    displayName TEXT,
    contentTierUuid TEXT,
    displayIcon TEXT,
    user_id TEXT REFERENCES users,
    tierRank TEXT,
    tierColor TEXT,
    tierText TEXT,
    basePrice TEXT,
    currentLvl INTEGER DEFAULT NULL,
    currentChroma INTEGER DEFAULT NULL,
    currentPrice INTEGER DEFAULT NULL,
    maxPrice INTEGER DEFAULT NULL
  )
`);
stmtSkins.run()

export const insertUser = flopoDB.prepare('INSERT INTO users (id, username, globalName, warned, warns, allTimeWarns, totalRequests) VALUES (@id, @username, @globalName, @warned, @warns, @allTimeWarns, @totalRequests)');
export const updateUser = flopoDB.prepare('UPDATE users SET warned = @warned, warns = @warns, allTimeWarns = @allTimeWarns, totalRequests = @totalRequests WHERE id = @id');
export const getUser = flopoDB.prepare('SELECT * FROM users WHERE id = ?');
export const getAllUsers = flopoDB.prepare('SELECT * FROM users');

export const insertSkin = flopoDB.prepare('INSERT INTO skins (uuid, displayName, contentTierUuid, displayIcon, user_id, tierRank, tierColor, tierText, basePrice, currentLvl, currentChroma, currentPrice, maxPrice) VALUES (@uuid, @displayName, @contentTierUuid, @displayIcon, @user_id, @tierRank, @tierColor, @tierText, @basePrice, @currentLvl, @currentChroma, @currentPrice, @maxPrice)');
export const updateSkin = flopoDB.prepare('UPDATE skins SET user_id = @user_id, currentLvl = @currentLvl, currentChroma = @currentChroma, currentPrice = @currentPrice WHERE uuid = @uuid');
export const getSkin = flopoDB.prepare('SELECT * FROM skins WHERE uuid = ?');
export const getAllSkins = flopoDB.prepare('SELECT * FROM skins ORDER BY maxPrice DESC');
export const getAllAvailableSkins = flopoDB.prepare('SELECT * FROM skins WHERE user_id IS NULL');
export const getUserInventory = flopoDB.prepare('SELECT * FROM skins WHERE user_id = @user_id ORDER BY currentPrice DESC');
export const getTopSkins = flopoDB.prepare('SELECT * FROM skins ORDER BY maxPrice DESC LIMIT 10');

export const insertManyUsers = flopoDB.transaction(async (users) => {
  for (const user of users) try { await insertUser.run(user) } catch (e) { console.log('user insert failed (might already exists)') }
});
export const updateManyUsers = flopoDB.transaction(async (users) => {
  for (const user of users) try { await updateUser.run(user) } catch (e) { console.log('user update failed') }
});

export const insertManySkins = flopoDB.transaction(async (skins) => {
  for (const skin of skins) try { await insertSkin.run(skin) } catch (e) { console.log('skin insert failed') }
});
export const updateManySkins = flopoDB.transaction(async (skins) => {
  for (const skin of skins) try { await updateSkin.run(skin) } catch (e) { console.log('skin insert failed') }
});


// insertManyUsers([
//   { id: '1234', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
//   { id: '12345', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
// ]);


// updateManyUsers([
//   { id: '1234', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
// ]);

//console.log(getUser.get('12345'))
