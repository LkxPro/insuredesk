/**
 * Fetch-and-save for the REST file endpoints (导出工单、导入模板). Session
 * cookies ride along automatically (same-origin). Throws with a displayable
 * message on any non-2xx, so the caller owns the toast.
 */

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

export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
