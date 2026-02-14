import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { relatedProjects } from "@vercel/related-projects";

const BACKEND_PROJECT_ID = process.env.RELATED_BACKEND_PROJECT_ID || "";

function ensureHttps(host) {
  if (!host) return "";
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `https://${host}`;
}

function getRelatedHost(defaultHost) {
  try {
    const projects = relatedProjects();
    const backend = projects.find((p) => p.projectId === BACKEND_PROJECT_ID);
    const host =
      backend?.targets?.preview?.url ||
      backend?.targets?.production?.url ||
      backend?.url ||
      backend?.host ||
      defaultHost;
    return ensureHttps(host);
  } catch {
    return defaultHost;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const defaultHost = env.VITE_API_URL || env.VITE_API_BASE || "";
  const relatedHost = process.env.VERCEL
    ? getRelatedHost(defaultHost)
    : defaultHost;
  const apiUrl = relatedHost || defaultHost;

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
    },
  };
});
