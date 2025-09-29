// lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/index"; // Your drizzle database instance
import * as schema from "@/db/schema"; // Your schema file
import { generateSecurityId, generateUserId } from "./id-generator";
import { createChildLogger } from "./logger";

const logger = createChildLogger("auth");

logger.info({}, "Initializing Better Auth configuration");
logger.debug(
  {
    dbLoaded: !!db,
    schemaLoaded: !!schema,
  },
  "DB and schema loading status",
);

let initializedAdapter;
try {
  if (
    !db ||
    !schema ||
    !schema.users ||
    !schema.sessions ||
    !schema.accounts ||
    !schema.verifications
  ) {
    logger.error(
      {
        dbLoaded: !!db,
        schemaLoaded: !!schema,
        usersLoaded: !!schema?.users,
        sessionsLoaded: !!schema?.sessions,
        accountsLoaded: !!schema?.accounts,
        verificationsLoaded: !!schema?.verifications,
      },
      "Critical: DB or schema parts are undefined. Adapter initialization will likely fail",
    );
    throw new Error("DB or schema not properly loaded for Drizzle adapter.");
  }
  initializedAdapter = drizzleAdapter(db, {
    provider: "pg", // Fixed: Use PostgreSQL provider
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  });
  logger.info({}, "Drizzle adapter initialized successfully");
} catch (error) {
  logger.error(
    {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    },
    "ERROR initializing Drizzle adapter",
  );
  // Consider how to handle this error; perhaps throw it to stop the app
  // or set initializedAdapter to a state that 'betterAuth' can handle or will clearly show an error.
}

export const auth = betterAuth({
  database: initializedAdapter, // Use the potentially try-catched adapter
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    fields: {
      name: "displayName", // Map Better Auth's "name" field to our "displayName" column
    },
    additionalFields: {
      fullName: {
        type: "string",
        required: false,
      },
      userType: {
        type: "string",
        required: true,
        defaultValue: "user",
      },
    },
  },
  account: {
    fields: { password: "passwordHash" },
  },
  verification: {
    fields: { value: "token" },
  },
  secret: (() => {
    if (!process.env.BETTER_AUTH_SECRET) {
      throw new Error("BETTER_AUTH_SECRET environment variable is required");
    }

    // Additional security validation is handled in env-validation.ts
    // This ensures the secret is not using insecure development patterns
    return process.env.BETTER_AUTH_SECRET;
  })(),
  //basePath: "/api/auth", // Keep this commented out as per previous advice
  trustedOrigins: [
    "http://localhost:3000",
    process.env.FRONTEND_URL || "http://localhost:3000",
  ],
  advanced: {
    database: {
      generateId: (options) => {
        switch (options.model) {
          case "user":
            return generateUserId();

          // Sessions, accounts, and verifications are security-sensitive.
          // Using a cryptographically secure UUID is a good practice.
          case "session":
          case "account":
          case "verification":
            return generateSecurityId();

          // A secure fallback for any other models that might be introduced.
          default:
            return generateSecurityId();
        }
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
