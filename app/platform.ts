/**
 * Android browsers struggle with very large photos and mixed file pickers, so
 * a few parts of the app adjust when running there.
 */
export const isAndroid = () => {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform === "Android" || /Android/i.test(navigator.userAgent);
};

export const isHeic = (file: File) =>
  /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
