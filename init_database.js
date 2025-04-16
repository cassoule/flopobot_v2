import Database from "better-sqlite3";


export const flopoDB = new Database('flopobot.db');

export const stmt = flopoDB.prepare(`
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
stmt.run();

export const insertUser = flopoDB.prepare('INSERT INTO users (id, username, globalName, warned, warns, allTimeWarns, totalRequests) VALUES (@id, @username, @globalName, @warned, @warns, @allTimeWarns, @totalRequests)');
export const updateUser = flopoDB.prepare('UPDATE users SET warned = @warned, warns = @warns, allTimeWarns = @allTimeWarns, totalRequests = @totalRequests WHERE id = @id');
export const getUser = flopoDB.prepare('SELECT * FROM users WHERE id = ?');
export const getAllUsers = flopoDB.prepare('SELECT * FROM users');

export const insertManyUsers = flopoDB.transaction(async (users) => {
  for (const user of users) try { await insertUser.run(user) } catch (e) { console.log('users insert failed') };
});
export const updateManyUsers = flopoDB.transaction(async (users) => {
  for (const user of users) try { await updateUser.run(user) } catch (e) { console.log('users update failed') };
});
//const getManyUsers = flopoDB.transaction(())


// insertManyUsers([
//   { id: '1234', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
//   { id: '12345', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
// ]);


// updateManyUsers([
//   { id: '1234', username: 'Username', globalName: 'GlobalName', warned: 0, warns: 0, allTimeWarns: 0, totalRequests: 0 },
// ]);

//console.log(getUser.get('12345'))
