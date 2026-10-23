import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Postgres is always available on every Neon branch — nothing to declare.
  // Branch policy: give non-default branches a 7-day auto-expiry.
  auth: false,
  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }
    if (!branch.exists) {
      return { ttl: "7d" };
    }
    return {};
  },
});
