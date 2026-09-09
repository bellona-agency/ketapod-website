import type { NextConfig } from "next";
import type { RemotePattern } from "next/dist/shared/lib/image-config";

/**
 * Covers, avatars and audio all come from whichever API host the build is
 * pointed at, so the image allowlist is derived from that same variable rather
 * than written out twice. Without this, running against the local Go core
 * (`NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`) makes every `next/image`
 * with a real `coverUrl` throw "hostname is not configured" — the fallback
 * covers hide it until the seed data has images.
 */
const apiPattern = (): RemotePattern[] => {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [
      {
        protocol: u.protocol.replace(":", "") as "http" | "https",
        hostname: u.hostname,
        ...(u.port ? { port: u.port } : {}),
      },
    ];
  } catch {
    return [];
  }
};

const nextConfig: NextConfig = {
  /* The container image ships only the server, its traced dependencies and
     the static assets — not the whole node_modules tree. It is the
     difference between a ~200MB image and a ~1GB one, and it is inert
     outside Docker: `next dev` and `next start` ignore it. */
  output: "standalone",

  images: {
    remotePatterns: [
      // Production: covers, avatars and partner logos from the API/CDN hosts.
      { protocol: "https", hostname: "api.ketapod.ir" },
      { protocol: "https", hostname: "cdn.ketapod.ir" },
      { protocol: "https", hostname: "**.ketapod.ir" },
      // Seed data ships placeholder covers from this host.
      { protocol: "https", hostname: "placehold.co" },
      // Local stack: the Go core, and MinIO's presigned object URLs.
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      ...apiPattern(),
    ],
  },
};

export default nextConfig;
