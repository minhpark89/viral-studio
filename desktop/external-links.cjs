function externalWebUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

async function openExternalWeb(shell, value) {
  const url = externalWebUrl(value);
  if (!url)
    throw new Error("Chỉ mở được đường dẫn web http hoặc https hợp lệ.");
  await shell.openExternal(url);
  return { opened: true, url };
}

module.exports = { externalWebUrl, openExternalWeb };
