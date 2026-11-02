// Note search (spec section 6): keyword matches from FTS5, plus meaning-based scores when the user picked an embedding
// model, weighted toward recent notes unless a note is evergreen. Without embeddings it is keyword search only.
import type { NotesStore, StoredNote } from "./notes.ts";

/** Turns texts into vectors with the embedding model the user chose; `model` names it, so vectors are kept per model. */
export interface Embedder {
	model: string;
	embed(texts: string[]): Promise<number[][]>;
}

export interface NoteHit {
	name: string;
	description: string;
	version: number;
	updatedAt: number;
	score: number;
}

const DAY = 86_400_000;
/** Below this cosine similarity a note is not a meaning-based candidate. */
const MIN_SIMILARITY = 0.35;

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Up to 1.5x for a note changed today, fading to 1x over about two months; evergreen notes stay at 1x. */
const recency = (note: StoredNote, now: number) =>
	note.evergreen ? 1 : 1 + 0.5 * Math.exp(-Math.max(0, now - note.updatedAt) / (30 * DAY));

/** Vectors for every note's current version, embedding only the ones missing. */
async function vectorsFor(store: NotesStore, notes: StoredNote[], embedder: Embedder): Promise<Map<string, number[]>> {
	const vectors = new Map<string, number[]>();
	const missing: StoredNote[] = [];
	for (const note of notes) {
		const vector = store.vector(note.name, note.version, embedder.model);
		if (vector) vectors.set(note.name, vector);
		else missing.push(note);
	}
	if (missing.length > 0) {
		const embedded = await embedder.embed(missing.map((note) => `${note.name}: ${note.description}\n${note.body}`));
		missing.forEach((note, index) => {
			const vector = embedded[index];
			if (!vector) return;
			store.setVector(note.name, note.version, embedder.model, vector);
			vectors.set(note.name, vector);
		});
	}
	return vectors;
}

export async function searchNotes(
	store: NotesStore,
	query: string,
	options: { limit: number; embedder?: Embedder; now?: number },
): Promise<NoteHit[]> {
	const now = options.now ?? Date.now();
	const notes = new Map(store.list().map((note) => [note.name, note]));
	const scores = new Map<string, number>();
	// bm25 ranks are negative, best lowest; the best match scores 1 and the rest by their share of it.
	const keyword = store.keywordMatches(query, Math.max(options.limit * 4, 20));
	const best = keyword[0]?.rank;
	for (const { name, rank } of keyword) scores.set(name, best ? rank / best : 1);
	if (options.embedder && notes.size > 0) {
		try {
			const vectors = await vectorsFor(store, [...notes.values()], options.embedder);
			const [queryVector] = await options.embedder.embed([query]);
			if (queryVector)
				for (const [name, vector] of vectors) {
					const similarity = cosine(queryVector, vector);
					if (similarity >= MIN_SIMILARITY) scores.set(name, (scores.get(name) ?? 0) + similarity);
				}
		} catch {
			// The embedding provider failed: keyword results still stand.
		}
	}
	return [...scores]
		.map(([name, score]) => {
			const note = notes.get(name)!;
			return {
				name,
				description: note.description,
				version: note.version,
				updatedAt: note.updatedAt,
				score: score * recency(note, now),
			};
		})
		.filter((hit) => notes.has(hit.name))
		.sort((a, b) => b.score - a.score)
		.slice(0, options.limit);
}

/** The user's chosen embedding model on an OpenAI-compatible `/embeddings` endpoint, with their API key. */
export function openAiCompatibleEmbedder(input: { baseUrl: string; apiKey: string; modelId: string }): Embedder {
	return {
		model: input.modelId,
		async embed(texts) {
			const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/embeddings`, {
				method: "POST",
				headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
				body: JSON.stringify({ model: input.modelId, input: texts }),
			});
			if (!response.ok) throw new Error(`embeddings failed (${response.status})`);
			const body = (await response.json()) as { data: { index: number; embedding: number[] }[] };
			return body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
		},
	};
}
