export type ImageDetail = "low" | "high" | "auto";

export function getImageDetail(): ImageDetail {
  const value = (process.env.OPENAI_IMAGE_DETAIL ?? "high").toLowerCase();
  if (value === "low" || value === "high" || value === "auto") {
    return value;
  }
  return "high";
}

/** quality = transcriptie + MegaMinnie; fast = één gecombineerde call. */
export function getPhotoPipeline(): "quality" | "fast" {
  return process.env.PHOTO_PIPELINE === "fast" ? "fast" : "quality";
}
