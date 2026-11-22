/**
 * GitHub repo constants, URL builders, and local app version for mobile update checks.
 */

import mobilePackage from '../../package.json';

const GITHUB_REPO = {
    owner: 'bloodycrownD',
    name: 'novel-master',
} as const;

const {owner, name} = GITHUB_REPO;

export const APP_VERSION = mobilePackage.version;

export namespace AppMeta {
    export function githubRepoUrl(): string {
        return `https://github.com/${owner}/${name}`;
    }

    export function githubReleasesUrl(): string {
        return `${githubRepoUrl()}/releases`;
    }

    export function licenseUrl(): string {
        return `${githubRepoUrl()}/blob/main/LICENSE`;
    }
}

export const APP_LINKS = {
    repo: AppMeta.githubRepoUrl(),
    releases: AppMeta.githubReleasesUrl(),
    license: AppMeta.licenseUrl(),
} as const;
