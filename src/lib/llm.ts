import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropic-client.js";
import { getChatModel, getLlmProvider, getVisionModel } from "./llm-config.js";
import { getImageDetail } from "./vision-config.js";
import { getOpenAiClient } from "./openai-client.js";

export type LlmImage = { buffer: Buffer; mimeType: string };

type AnthropicImageMedia =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

function toAnthropicMediaType(mimeType: string): AnthropicImageMedia {
  if (
    mimeType === "image/png" ||
    mimeType === "image/gif" ||
    mimeType === "image/webp"
  ) {
    return mimeType;
  }
  return "image/jpeg";
}

function extractAnthropicText(
  content: Anthropic.Messages.Message["content"],
): string {
  const parts = content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text);
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("Claude gaf geen tekstantwoord terug");
  }
  return text;
}

/** Tekst → antwoord (MegaMinnie JSON-stap). */
export async function createJsonCompletion(
  system: string,
  user: string,
): Promise<string> {
  if (getLlmProvider() === "anthropic") {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: getChatModel(),
      max_tokens: 8192,
      system: `${system}\n\nBelangrijk: antwoord uitsluitend als raw JSON-object, zonder markdown-codeblokken.`,
      messages: [{ role: "user", content: user }],
    });
    return extractAnthropicText(response.content);
  }

  const completion = await getOpenAiClient().chat.completions.create({
    model: getChatModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI gaf geen antwoord terug");
  }
  return content;
}

/** Foto('s) + instructie → tekst of JSON. */
export async function createVisionCompletion(params: {
  system: string;
  userText: string;
  images: LlmImage[];
  jsonMode?: boolean;
}): Promise<string> {
  const { system, userText, images, jsonMode } = params;

  if (images.length === 0) {
    throw new Error("Geen foto's ontvangen");
  }

  if (getLlmProvider() === "anthropic") {
    const client = getAnthropicClient();
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const img of images) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: toAnthropicMediaType(img.mimeType),
          data: img.buffer.toString("base64"),
        },
      });
    }
    content.push({ type: "text", text: userText });

    const response = await client.messages.create({
      model: getVisionModel(),
      max_tokens: 8192,
      system: jsonMode
        ? `${system}\n\nBelangrijk: antwoord uitsluitend als raw JSON-object, zonder markdown-codeblokken.`
        : system,
      messages: [{ role: "user", content }],
    });
    return extractAnthropicText(response.content);
  }

  const detail = getImageDetail();
  const parts: Array<
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string; detail?: "low" | "high" | "auto" };
      }
  > = [{ type: "text", text: userText }];

  for (const img of images) {
    const dataUrl = `data:${img.mimeType};base64,${img.buffer.toString("base64")}`;
    parts.push({
      type: "image_url",
      image_url: { url: dataUrl, detail },
    });
  }

  const completion = await getOpenAiClient().chat.completions.create({
    model: getVisionModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: parts },
    ],
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Geen tekst uit de foto's gehaald");
  }
  return text;
}
