// generate_image (spec section 5): offered only when one of the user's own providers has an image model. Which model
// is the user's call: with one available it is used, with several the bot asks which one (they are listed in the
// tool's description). Images are saved to the user's files as the bot's output.
import type { ImageApi, ImageModel as AnyImageModel, Models } from "@knightcode/ai";
import type { FileRef } from "@knightcode/bots-protocol";
import { defineTool } from "@knightcode/durable";
import { obj, opt, str } from "@knightcode/schema";

type ImageModel = AnyImageModel<ImageApi>;

export type SaveImage = (image: { name: string; mime: string; bytes: Uint8Array }) => Promise<FileRef>;

/** The image models the user's connected providers can run now. */
export async function availableImageModels(models: Models): Promise<ImageModel[]> {
	try {
		return [...(await models.getAvailableOfType("image"))] as ImageModel[];
	} catch {
		return [];
	}
}

const extension = (mime: string) => (mime.split("/")[1] ?? "png").replace("jpeg", "jpg");

export function imageTool(input: { models: Models; available: ImageModel[]; save: SaveImage }) {
	const ids = input.available.map((model) => `${model.provider}/${model.id}`);
	return defineTool({
		name: "generate_image",
		description: `Create an image from a description and save it to the user's files. Image models available: ${ids.join(", ")}.${
			ids.length > 1 ? " Ask the user which to use if they have not said." : ""
		}`,
		deferred: true,
		parameters: obj({
			prompt: str(),
			model: opt(str({ description: "provider/model, one of the available image models" })),
		}),
		execute: async ({ prompt, model }) => {
			const chosen = model
				? input.available.find((candidate) => `${candidate.provider}/${candidate.id}` === model)
				: input.available.length === 1
					? input.available[0]
					: undefined;
			if (!chosen)
				return {
					output: [{ type: "text" as const, text: `Choose one of these image models: ${ids.join(", ")}.` }],
					isError: true,
				};
			const result = await input.models.generateImages(chosen, { input: [{ type: "text", text: prompt }] });
			if (result.stopReason !== "stop")
				return { output: [{ type: "text" as const, text: result.errorMessage ?? "The image failed." }], isError: true };
			const saved: FileRef[] = [];
			for (const [index, block] of result.output.entries()) {
				if (block.type !== "image") continue;
				const bytes = Uint8Array.from(atob(block.data), (c) => c.charCodeAt(0));
				saved.push(await input.save({ name: `image-${Date.now()}-${index + 1}.${extension(block.mimeType)}`, mime: block.mimeType, bytes }));
			}
			return { output: [{ type: "text" as const, text: JSON.stringify({ saved: saved.map((file) => ({ id: file.id, name: file.name })) }) }] };
		},
	});
}
