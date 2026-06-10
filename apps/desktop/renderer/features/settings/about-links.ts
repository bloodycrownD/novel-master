/** GitHub link URLs for About page (mirrors main/update-check/app-meta). */

const OWNER = "bloodycrownD";
const NAME = "novel-master";

export const ABOUT_LINKS = {
  repo: `https://github.com/${OWNER}/${NAME}`,
  releases: `https://github.com/${OWNER}/${NAME}/releases`,
  license: `https://github.com/${OWNER}/${NAME}/blob/main/LICENSE`,
} as const;
