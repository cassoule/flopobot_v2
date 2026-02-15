import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware that requires a valid JWT token in the Authorization header.
 * Sets req.userId to the authenticated Discord user ID.
 */
export function requireAuth(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Authentication required." });
	}

	const token = authHeader.split("Bearer ")[1];
	try {
		const payload = jwt.verify(token, JWT_SECRET);
		req.userId = payload.discordId;
		next();
	} catch (err) {
		return res.status(401).json({ error: "Invalid or expired token." });
	}
}

/**
 * Optional auth middleware - attaches userId if token is present, but doesn't block.
 * Useful for routes that work for both authenticated and unauthenticated users.
 */
export function optionalAuth(req, res, next) {
	const authHeader = req.headers.authorization;
	if (authHeader && authHeader.startsWith("Bearer ")) {
		const token = authHeader.split("Bearer ")[1];
		try {
			const payload = jwt.verify(token, JWT_SECRET);
			req.userId = payload.discordId;
		} catch {
			// Token invalid, continue without userId
		}
	}
	next();
}

/**
 * Signs a JWT token for a given Discord user ID.
 * @param {string} discordId - The Discord user ID.
 * @returns {string} The signed JWT token.
 */
export function signToken(discordId) {
	return jwt.sign({ discordId }, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Verifies a JWT token and returns the payload.
 * @param {string} token - The JWT token to verify.
 * @returns {object|null} The decoded payload or null if invalid.
 */
export function verifyToken(token) {
	try {
		return jwt.verify(token, JWT_SECRET);
	} catch {
		return null;
	}
}
