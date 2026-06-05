import prisma from "../prisma/client.js";

/**
 * Get all patch notes, ordered by creation date (newest first).
 */
export async function getAllPatchNotes() {
	return prisma.patchNote.findMany({
		orderBy: { createdAt: "desc" },
		include: {
			author: {
				select: { id: true, username: true, globalName: true, avatarUrl: true },
			},
		},
	});
}

/**
 * Get only published patch notes (for public display).
 */
export async function getPublishedPatchNotes() {
	return prisma.patchNote.findMany({
		where: { published: true },
		orderBy: { createdAt: "desc" },
		include: {
			author: {
				select: { id: true, username: true, globalName: true, avatarUrl: true },
			},
		},
	});
}

/**
 * Get a single patch note by ID.
 */
export async function getPatchNoteById(id) {
	return prisma.patchNote.findUnique({
		where: { id },
		include: {
			author: {
				select: { id: true, username: true, globalName: true, avatarUrl: true },
			},
		},
	});
}

/**
 * Create a new patch note.
 * @param {object} data - { title, version, content, authorId, published }
 */
export async function createPatchNote(data) {
	return prisma.patchNote.create({
		data: {
			title: data.title,
			version: data.version || null,
			content: data.content,
			authorId: data.authorId,
			published: data.published ?? false,
		},
		include: {
			author: {
				select: { id: true, username: true, globalName: true, avatarUrl: true },
			},
		},
	});
}

/**
 * Update an existing patch note.
 * @param {string} id - The patch note ID.
 * @param {object} data - Fields to update (title, version, content, published).
 */
export async function updatePatchNote(id, data) {
	return prisma.patchNote.update({
		where: { id },
		data: {
			...(data.title !== undefined && { title: data.title }),
			...(data.version !== undefined && { version: data.version }),
			...(data.content !== undefined && { content: data.content }),
			...(data.published !== undefined && { published: data.published }),
		},
		include: {
			author: {
				select: { id: true, username: true, globalName: true, avatarUrl: true },
			},
		},
	});
}

/**
 * Delete a patch note by ID.
 */
export async function deletePatchNote(id) {
	return prisma.patchNote.delete({
		where: { id },
	});
}
