import { parentPort, workerData } from "worker_threads";
import { generateWithDefinitions, getAllWords } from "mots-fleches";

async function run() {
	const { rows, cols, seedString } = workerData;
	const words = getAllWords();
	const result = await generateWithDefinitions(words, rows, cols, { seedString });

	if (!result) {
		parentPort.postMessage({ ok: false });
		return;
	}

	parentPort.postMessage({
		ok: true,
		result: {
			grid: result.grid,
			slots: result.slots,
			defCells: Array.from(result.defCells.entries()),
			definitions: result.definitions || {},
			wordCount: result.wordCount,
			seedString: result.seedString || null,
			generationTimeMs: result.generationTimeMs ?? 0,
		},
	});
}

run().catch((err) => {
	parentPort.postMessage({ ok: false, error: err?.message || String(err) });
});
