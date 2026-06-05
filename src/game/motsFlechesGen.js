import { Worker } from "worker_threads";

const WORKER_URL = new URL("./motsFlechesWorker.js", import.meta.url);

function generateOnce({ rows, cols, seedString }) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(WORKER_URL, { workerData: { rows, cols, seedString } });
		let done = false;
		const settle = (fn, arg) => {
			if (done) return;
			done = true;
			worker.terminate().catch(() => {});
			fn(arg);
		};

		worker.once("message", (msg) => {
			if (msg?.ok) settle(resolve, msg.result);
			else settle(reject, new Error(msg?.error || "generation returned no grid"));
		});
		worker.once("error", (err) => settle(reject, err));
		worker.once("exit", (code) => {
			if (code !== 0) settle(reject, new Error(`worker exited with code ${code}`));
		});
	});
}

export async function generateMotsFlechesGrid({ rows, cols, seedString }, attempts = 3) {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await generateOnce({ rows, cols, seedString });
		} catch (e) {
			console.error(`[MotsFleches] gen attempt ${attempt} failed:`, e?.message || e);
			if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000 * attempt));
		}
	}
	return null;
}
