import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { withRelatedProject } from "@vercel/related-projects";

const explicitApiHost =
  process.env.VITE_API_URL || process.env.VITE_API_BASE || "";
const relatedApiHost = withRelatedProject({
  projectName: "votefeed-org-backend",
  defaultHost: explicitApiHost,
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_RELATED_API_URL": JSON.stringify(
      relatedApiHost || "",
    ),
  },
});
