/** Server rejections carry `{ error }` JSON; anything else gets a generic line. */
async function extractError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) {
      return body.error;
    }
  } catch {
    // non-JSON body (proxy error page, say) — fall through
  }
  return `下载失败（${response.status}）`;
}

/** 服务端 Content-Disposition 只下 ASCII filename（无 filename* 分支）。 */
function serverFilename(response: Response): string | null {
  const header = response.headers.get("content-disposition");
  const match = /filename="?([^";]+)"?/i.exec(header ?? "");
  return match?.[1] ?? null;
}

export async function downloadFile(
  url: string,
  filename: string,
  options?: { preferServerFilename?: boolean },
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = (options?.preferServerFilename ? serverFilename(response) : null) ?? filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
