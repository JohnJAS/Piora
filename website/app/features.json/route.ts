import { featureGroups, githubUrl, latestReleaseUrl, quickStartSteps } from '../site-data';

export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    schemaVersion: 1,
    product: {
      name: 'Piora',
      description: 'Open-source, local-first desktop workspace for the Pi agent runtime.',
      license: 'MIT',
      platforms: ['Windows 10/11 x64', 'Linux x64'],
      repository: githubUrl,
      latestRelease: latestReleaseUrl,
      relationship: 'Community-maintained; not affiliated with Pi, pi-web, OpenAI, or Codex.',
    },
    capabilityGroups: featureGroups,
    quickStart: quickStartSteps,
    canonicalDocs: {
      humanOverview: '/',
      llmText: '/llms.txt',
      sourceReadme: `${githubUrl}#readme`,
      releases: latestReleaseUrl,
      security: `${githubUrl}/blob/main/SECURITY.md`,
      privacy: `${githubUrl}/blob/main/docs/open-source/PRIVACY_AND_NETWORK.md`,
    },
  });
}
